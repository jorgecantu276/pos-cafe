[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Address, [Parameter(Mandatory=$true)][string]$Directory, [Parameter(Mandatory=$true)][string]$LeafDirectory)
$ErrorActionPreference = 'Stop'

# CertificateRequest signs in memory. No Windows certificate-store, trust or
# firewall changes are made. The public CA is installed deliberately on devices.
Add-Type -ReferencedAssemblies @('System.dll','System.Core.dll','System.Security.dll') -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
public static class SmoothiesCertificate {
  static byte[] Der(byte tag, params byte[][] values) {
    byte[] data=values.SelectMany(v=>v).ToArray();
    byte[] length=data.Length<128 ? new[]{(byte)data.Length} : BitConverter.GetBytes(data.Length).Reverse().SkipWhile(v=>v==0).ToArray();
    if(data.Length>=128) length=(new[]{(byte)(0x80|length.Length)}).Concat(length).ToArray();
    return (new[]{tag}).Concat(length).Concat(data).ToArray();
  }
  static byte[] Integer(byte[] data) {
    data=data.SkipWhile(v=>v==0).ToArray();
    if(data.Length==0) data=new byte[]{0};
    if(data[0]>=128) data=(new byte[]{0}).Concat(data).ToArray();
    return Der(2,data);
  }
  static string Pem(string label,byte[] data) {
    return "-----BEGIN "+label+"-----\n"+Convert.ToBase64String(data,Base64FormattingOptions.InsertLineBreaks)+"\n-----END "+label+"-----\n";
  }
  public static void Create(string address,string directory,string leafDirectory) {
    var ip=System.Net.IPAddress.Parse(address);
    if(ip.AddressFamily!=System.Net.Sockets.AddressFamily.InterNetwork) throw new ArgumentException("Use IPv4");
    using(var authority=new RSACng(2048)) using(var key=new RSACng(2048)) {
      var before=DateTimeOffset.UtcNow.AddMinutes(-5);
      var caRequest=new CertificateRequest("CN=POS Smoothies Local CA",authority,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
      caRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true,false,0,true));
      caRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign|X509KeyUsageFlags.CrlSign,true));
      var authorityFile=Path.Combine(directory,"authority.dpapi");
      X509Certificate2 authorityCertificate;
      if(File.Exists(authorityFile)) {
        var pfx=ProtectedData.Unprotect(File.ReadAllBytes(authorityFile),null,DataProtectionScope.CurrentUser);
        authorityCertificate=new X509Certificate2(pfx,"",X509KeyStorageFlags.Exportable|X509KeyStorageFlags.EphemeralKeySet);
        Array.Clear(pfx,0,pfx.Length);
      } else {
        authorityCertificate=caRequest.CreateSelfSigned(before,before.AddYears(5));
        var pfx=authorityCertificate.Export(X509ContentType.Pfx,"");
        File.WriteAllBytes(authorityFile,ProtectedData.Protect(pfx,null,DataProtectionScope.CurrentUser));
        Array.Clear(pfx,0,pfx.Length);
      }
      using(var ca=authorityCertificate) {
        if(ca.NotAfter.ToUniversalTime()<=before.AddDays(366).UtcDateTime) throw new InvalidOperationException("La autoridad HTTPS requiere reinscripcion de confianza.");
        var request=new CertificateRequest("CN=POS Smoothies "+address,key,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false,false,0,true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature|X509KeyUsageFlags.KeyEncipherment,true));
        var purposes=new OidCollection();purposes.Add(new Oid("1.3.6.1.5.5.7.3.1"));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(purposes,true));
        request.CertificateExtensions.Add(new X509Extension("2.5.29.17",Der(0x30,Der(0x87,ip.GetAddressBytes())),false));
        var serial=new byte[16];using(var random=RandomNumberGenerator.Create())random.GetBytes(serial);serial[0]&=0x7f;serial[0]|=1;
        using(var server=request.Create(ca,before,before.AddDays(365),serial)) {
          File.WriteAllBytes(Path.Combine(directory,"Smoothies-iPad-CA.cer"),ca.Export(X509ContentType.Cert));
          File.WriteAllText(Path.Combine(directory,"Smoothies-iPad-CA.pem"),Pem("CERTIFICATE",ca.RawData),new UTF8Encoding(false));
          File.WriteAllText(Path.Combine(leafDirectory,"server.pem"),Pem("CERTIFICATE",server.RawData)+Pem("CERTIFICATE",ca.RawData),new UTF8Encoding(false));
          var p=key.ExportParameters(true);
          var pkcs1=Der(0x30,Integer(new byte[]{0}),Integer(p.Modulus),Integer(p.Exponent),Integer(p.D),Integer(p.P),Integer(p.Q),Integer(p.DP),Integer(p.DQ),Integer(p.InverseQ));
          File.WriteAllText(Path.Combine(leafDirectory,"server-key.pem"),Pem("RSA PRIVATE KEY",pkcs1),new UTF8Encoding(false));
        }
      }
    }
  }
}
'@
[SmoothiesCertificate]::Create($Address, $Directory, $LeafDirectory)

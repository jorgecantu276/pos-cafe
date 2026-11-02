// A five-character SQLSTATE is not proof that a write did not commit.
// Connection errors (08...), transaction-resolution-unknown (08007), and
// statement-completion-unknown (40003) must keep the original recovery identity.
// Use only the RPCs' business rejections and input/integrity errors as positive
// evidence of rejection; unrecognized failures stay pending for exact replay.
export function isDefinitiveWriteRejection(code: unknown): boolean {
  return typeof code === 'string' && (code === 'P0001' || /^(22|23)[0-9A-Z]{3}$/.test(code));
}

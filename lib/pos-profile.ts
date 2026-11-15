const profiles = {
  cafe: {
    id: 'cafe', title: 'Cariñito Mío POS', shortName: 'Cariñito Mío', brand: 'Cariñito Mío',
    staffDomain: 'carinitomio.local', ticketPrefix: 'CM', themeColor: '#0071e3', manifest: '/manifest.json',
  },
  smoothies: {
    id: 'smoothies', title: 'POS Smoothies', shortName: 'POS Smoothies', brand: 'Barra de smoothies',
    staffDomain: 'smoothies.local', ticketPrefix: 'Ticket', themeColor: '#812d50', manifest: '/manifest-smoothies.json',
  },
} as const;

export function selectPosProfile(value?: string) {
  switch (value) {
    case undefined:
    case 'cafe':
      return profiles.cafe;
    case 'smoothies':
      return profiles.smoothies;
    default:
      throw new Error('NEXT_PUBLIC_POS_PROFILE debe ser cafe o smoothies.');
  }
}

export const posProfile = selectPosProfile(process.env.NEXT_PUBLIC_POS_PROFILE);

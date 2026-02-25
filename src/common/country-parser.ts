const COUNTRY_CODES = [
  'TR', 'EN', 'IT', 'DE', 'FR', 'RU', 'BG', 'NZ', 'AU', 'CA', 'AUST',
  'ES', 'SP', 'NL', 'BE', 'AT', 'CH', 'PL', 'UK', 'US', 'GB', 'IE', 'PT',
  'GR', 'CZ', 'HU', 'RO', 'SE', 'NO', 'DK', 'FI', 'SK', 'HR', 'SI',
  'LT', 'LV', 'EE', 'CY', 'MT', 'LU', 'IS', 'AE', 'SA', 'QA', 'KW',
  'BH', 'OM', 'JO', 'LB', 'IL', 'EG', 'MA', 'TN', 'DZ', 'LY', 'KE',
  'NG', 'ZA', 'GH', 'IN', 'PK', 'BD', 'LK', 'NP', 'ID', 'MY', 'SG',
  'TH', 'VN', 'PH', 'JP', 'KR', 'CN', 'HK', 'TW', 'MX', 'BR', 'AR',
  'CO', 'CL', 'PE', 'VE', 'EC', 'UY', 'PY', 'BO', 'CR', 'PA', 'DO',
  'GT', 'HN', 'SV', 'NI', 'CU', 'PR', 'JM', 'TT', 'BB', 'BS'
];

export function parseCountriesFromName(name: string): string[] {
  const found: string[] = [];
  const upperName = name.toUpperCase();

  for (const code of COUNTRY_CODES) {
    const patterns = [
      new RegExp(`[-_/\\s]${code}[-_/\\s]`, 'i'),
      new RegExp(`[-_/\\s]${code}$`, 'i'),
      new RegExp(`^${code}[-_/\\s]`, 'i'),
      new RegExp(`[-_/]${code}[-_/]`, 'i'),
    ];

    for (const pattern of patterns) {
      if (pattern.test(upperName) && !found.includes(code)) {
        found.push(code);
        break;
      }
    }
  }

  return found.length > 0 ? found : [];
}

export function formatCountries(countries: string[]): string {
  if (countries.length === 0) return '-';
  return countries.join(', ');
}

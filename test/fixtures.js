// Shared test fixture: a valid 腔口差 entry and its key.

// trace: sha256("八\npueh") = 0a15ee4ada350df8…, cross-checked with node:crypto createHash
export const KEY = '0a15ee4ada350df8';

export const accentEntry = () => ({
  hanji: '八',
  tl: 'pueh',
  category: 'khiunn-khau',
  variation_types: ['gi-im'],
  accents: ['鹿港偏泉腔'],
  place: '',
  meaning: '',
  source: '',
  note: '鹿港講 pueh。',
  contributor: 'octocat',
  contributor_id: 583231,
  submitted: '2026-11-20',
});

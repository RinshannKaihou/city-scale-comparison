import type { Region } from '@/types/city';

export const REGION_ORDER: Region[] = [
  'china',
  'asia',
  'europe',
  'north-america',
  'south-america',
  'africa',
];

export const REGION_LABELS: Record<Region, { zh: string; en: string }> = {
  china:           { zh: '中国', en: 'China' },
  asia:            { zh: '亚洲', en: 'Asia' },
  europe:          { zh: '欧洲', en: 'Europe' },
  'north-america': { zh: '北美', en: 'North America' },
  'south-america': { zh: '南美', en: 'South America' },
  africa:          { zh: '非洲', en: 'Africa' },
};

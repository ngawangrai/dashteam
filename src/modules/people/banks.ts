// Banks staff can be paid into. To confirm with the founder before go-live.
export const BANKS = [
  "Bank of Bhutan",
  "Bhutan National Bank",
  "Druk PNB Bank",
  "T Bank",
  "Bhutan Development Bank",
] as const;

export type Bank = (typeof BANKS)[number];

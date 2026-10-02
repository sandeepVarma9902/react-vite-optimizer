const SYMBOLS = { USD: "$", EUR: "€", INR: "₹", GBP: "£" };

export function formatPrice(amount, currency = "USD") {
  const symbol = SYMBOLS[currency] || currency + " ";
  return `${symbol}${Number(amount).toFixed(2)}`;
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

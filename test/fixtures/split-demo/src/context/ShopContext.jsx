import React, { createContext, useContext, useMemo, useState } from 'react';

const ShopContext = createContext(null);

const CURRENCIES = ["USD", "EUR", "INR"];

export function ShopProvider({ children }) {
  const [currency, setCurrency] = useState("USD");
  const [locale, setLocale] = useState("en-US");

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      locale,
      setLocale,
      currencies: CURRENCIES,
    }),
    [currency, locale]
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used inside <ShopProvider>");
  return ctx;
}

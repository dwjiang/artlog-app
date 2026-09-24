import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from "react";

export const TabBarVisibility = createContext<Dispatch<SetStateAction<boolean>> | undefined>(undefined);

export function useHideTabBar(hidden: boolean) {
  const setHidden = useContext(TabBarVisibility);
  useEffect(() => {
    setHidden?.(hidden);
    return () => setHidden?.(false);
  }, [hidden, setHidden]);
}

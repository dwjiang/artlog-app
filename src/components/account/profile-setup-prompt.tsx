import { useQuery } from "convex/react";
import { router, usePathname } from "expo-router";
import { useEffect } from "react";

import { profileSetupRoute, takeProfileSetupOffer, useProfileSetupOffer } from "@/lib/account/profile-setup-offer";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";

/** Inline sign-ins use this prompt; the sign-in and welcome screens own their handoffs. */
export function ProfileSetupPrompt() {
  const offer = useProfileSetupOffer();
  const pathname = usePathname();
  const ready = useDeviceReady();
  const account = useQuery(api.accounts.me, offer && ready ? {} : "skip");
  useEffect(() => {
    if (!offer || !account || pathname === "/sign-in" || pathname === "/welcome") return;
    takeProfileSetupOffer();
    if (account.linked && account.hasProfile === false) router.push(profileSetupRoute(offer));
  }, [account, offer, pathname]);
  return null;
}

import { useQuery } from "convex/react";
import { router, usePathname } from "expo-router";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import { profileSetupRoute, takeProfileSetupOffer, useProfileSetupOffer } from "@/lib/account/profile-setup-offer";
import { useDeviceReady } from "@/lib/use-device-ready";

/** Opens profile setup after an inline Apple sign-in; the sign-in sheet hands off to setup itself. */
export function ProfileSetupPrompt() {
  const offer = useProfileSetupOffer();
  const pathname = usePathname();
  const ready = useDeviceReady();
  const account = useQuery(api.accounts.me, offer && ready ? {} : "skip");
  useEffect(() => {
    if (!offer || !account || pathname === "/sign-in") return;
    takeProfileSetupOffer();
    if (account.linked && account.hasProfile === false) router.push(profileSetupRoute(offer));
  }, [account, offer, pathname]);
  return null;
}

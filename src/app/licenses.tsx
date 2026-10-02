import { OpenSourceLicenses } from "@/components/settings/open-source-licenses";

import notices from "../../assets/licenses/third-party-notices.json";

export default function LicensesRoute() {
  return <OpenSourceLicenses notices={notices} />;
}

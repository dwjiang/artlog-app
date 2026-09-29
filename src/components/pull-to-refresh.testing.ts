import { RefreshControl, type RefreshControlProps } from "react-native";

/** Props of the refresh control that mounted last, which React Native's Jest mock records. For tests only. */
export function lastRefreshControl() {
  return (RefreshControl as unknown as { latestRef: { props: RefreshControlProps } }).latestRef.props;
}

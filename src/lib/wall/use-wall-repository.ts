import { flushCollectionMedia } from "../account/collection-sync";
import { useAuthToken } from "@convex-dev/auth/react";
import { getNetworkStateAsync } from "expo-network";
import { useEffect, useState, useSyncExternalStore } from "react";
import { captureOwner, subscribeOwner } from "../account/owner-store";
import { createWallRepository } from "./wall-repository";
import { createWallTransport } from "./wall-transport";

function createSession() {
  let token: string | null = null;
  const repository = createWallRepository({
    transport: (() => {
      const transport = createWallTransport(process.env.EXPO_PUBLIC_CONVEX_URL!);
      return {
        ...transport,
        setLayout: async (...args: Parameters<typeof transport.setLayout>) => {
          await flushCollectionMedia({
            photoLocalIds: args[0].items.flatMap((item) =>
              item.photoLocalId ? [item.photoLocalId] : [],
            ),
          });
          return transport.setLayout(...args);
        },
      };
    })(),
    capture: () => ({ ...captureOwner(), token }),
    subscribeOwner,
    online: async () => {
      const network = await getNetworkStateAsync();
      return network.isInternetReachable === true && network.isConnected === true;
    },
  });
  return {
    repository,
    setToken: (value: string | null) => {
      token = value;
    },
  };
}

export function useWallRepository() {
  const token = useAuthToken();
  const [session] = useState(createSession);
  const { repository } = session;
  useEffect(() => {
    session.setToken(token);
  }, [session, token]);
  useEffect(() => {
    repository.connect();
    return () => repository.dispose();
  }, [repository]);
  const state = useSyncExternalStore(
    repository.subscribe,
    repository.getSnapshot,
    repository.getSnapshot,
  );
  return { ...state, repository };
}

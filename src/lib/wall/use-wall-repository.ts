import { useAuthToken } from "@convex-dev/auth/react";
import { getNetworkStateAsync } from "expo-network";
import { useEffect, useState, useSyncExternalStore } from "react";

import { flushCollectionMedia } from "@/lib/account/collection-sync";
import { captureOwner, subscribeOwner, useLocalOwner } from "@/lib/account/owner-store";

import { createLocalWallRepository } from "./local-wall-repository";
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
            photoLocalIds: args[0].items.flatMap((item) => (item.photoLocalId ? [item.photoLocalId] : [])),
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
  const signedIn = useLocalOwner().startsWith("account:");
  const [session] = useState(createSession);
  const [local] = useState(createLocalWallRepository);
  const repository = signedIn ? session.repository : local;
  useEffect(() => {
    session.setToken(token);
  }, [session, token]);
  useEffect(() => {
    repository.connect();
    return () => repository.dispose();
  }, [repository]);
  const state = useSyncExternalStore(repository.subscribe, repository.getSnapshot, repository.getSnapshot);
  return { ...state, repository };
}

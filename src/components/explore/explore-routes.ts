import { router } from "expo-router";

export const openExhibition = (exhibitionId: string) =>
  router.push({ pathname: "/exhibition/[exhibitionId]", params: { exhibitionId } });

export const openMuseum = (museumId: string) => router.push({ pathname: "/museum/[museumId]", params: { museumId } });

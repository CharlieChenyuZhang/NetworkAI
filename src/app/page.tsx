import { NetworkApp } from "@/components/network-app";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  return (
    <NetworkApp
      view="discover"
      initialQuery={typeof q === "string" ? q.slice(0, 500) : ""}
    />
  );
}

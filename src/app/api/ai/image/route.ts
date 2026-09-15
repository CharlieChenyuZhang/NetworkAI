import { handleImageRequest } from "@/lib/server/image-handler";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  return handleImageRequest(request);
}

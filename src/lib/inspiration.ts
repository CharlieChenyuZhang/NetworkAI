import type { Post } from "./types";
export type InspirationPost = Post & {
  category?: string;
  aspect?: string;
  sample?: boolean;
};
export const inspirationPosts: InspirationPost[] = [
  {
    id: "preview-lake",
    user: "The quiet collection",
    message: "Somewhere between the mountains and the sky.",
    url: "/images/alpine-lake.jpg",
    type: "image",
    category: "Nature",
    aspect: "4 / 3",
    sample: true,
  },
  {
    id: "preview-ocean",
    user: "The quiet collection",
    message: "Let your thoughts drift a little.",
    url: "/images/ocean.jpg",
    type: "image",
    category: "Nature",
    aspect: "4 / 5",
    sample: true,
  },
  {
    id: "preview-interior",
    user: "Spaces & stories",
    message: "A slower kind of Sunday.",
    url: "/images/interior.jpg",
    type: "image",
    category: "Architecture",
    aspect: "4 / 5",
    sample: true,
  },
  {
    id: "preview-forest",
    user: "Outside the ordinary",
    message: "Into the green, away from the noise.",
    url: "/images/forest.jpg",
    type: "image",
    category: "Nature",
    aspect: "4 / 3",
    sample: true,
  },
  {
    id: "preview-mountain",
    user: "Outside the ordinary",
    message: "A different perspective changes everything.",
    url: "/images/mountain.jpg",
    type: "image",
    category: "Photography",
    aspect: "4 / 3",
    sample: true,
  },
  {
    id: "preview-landscape",
    user: "Spaces & stories",
    message: "Room to wander. Space to imagine.",
    url: "/images/landscape.jpg",
    type: "image",
    category: "Photography",
    aspect: "4 / 3",
    sample: true,
  },
];

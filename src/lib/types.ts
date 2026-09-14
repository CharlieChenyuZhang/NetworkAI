export interface Post {
  id: string;
  user: string;
  message: string;
  url: string;
  type: "image" | "video";
  createdAt?: string;
}

export interface SearchOptions {
  keywords?: string;
  user?: string;
}

export interface CreatePostInput {
  message: string;
  media: File;
}

export interface AuthUser {
  username: string;
}

export interface Session {
  token: string;
  user: AuthUser;
  expiresAt: number | null;
}

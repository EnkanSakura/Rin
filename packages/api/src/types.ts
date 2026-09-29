// ============================================================================
// Shared API Types - Used by both client and server
// ============================================================================

// Common types
export interface ApiResponse<T> {
  data?: T;
  error?: {
    status: number;
    value: string;
  };
}

export interface RequestOptions {
  headers?: Record<string, string>;
}

// ============================================================================
// Feed Types
// ============================================================================

export interface Feed {
  id: number;
  title: string | null;
  content: string;
  uid: number;
  createdAt: string;
  updatedAt: string;
  ai_summary: string;
  ai_summary_status: "idle" | "pending" | "processing" | "completed" | "failed";
  ai_summary_error: string;
  hashtags: Array<{ id: number; name: string }>;
  user: {
    avatar: string | null;
    id: number;
    username: string;
  };
  pv: number;
  uv: number;
  top?: number;
}

export interface FeedListResponse {
  size: number;
  data: Array<{
    id: number;
    title: string | null;
    summary: string;
    hashtags: Array<{ id: number; name: string }>;
    user: {
      avatar: string | null;
      id: number;
      username: string;
    };
    avatar: string | null;
    createdAt: string;
    updatedAt: string;
    pv: number;
    uv: number;
  }>;
  hasNext: boolean;
}

export interface TimelineItem {
  id: number;
  title: string | null;
  createdAt: string;
}

export interface CreateFeedRequest {
  title: string;
  content: string;
  summary?: string;
  alias?: string;
  draft: boolean;
  listed: boolean;
  createdAt?: string;
  tags: string[];
}

export interface UpdateFeedRequest {
  title?: string;
  content?: string;
  summary?: string;
  alias?: string;
  listed: boolean;
  draft?: boolean;
  createdAt?: string;
  tags?: string[];
  top?: number;
}

export interface AdjacentFeed {
  id: number;
  title: string | null;
  summary: string;
  hashtags: Array<{ id: number; name: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AdjacentFeedResponse {
  previousFeed: AdjacentFeed | null;
  nextFeed: AdjacentFeed | null;
}

// ============================================================================
// User Types
// ============================================================================

export interface UserProfile {
  id: number;
  username: string;
  avatar: string | null;
  permission: boolean;
}

export interface UpdateProfileRequest {
  username?: string;
  avatar?: string | null;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface AuthStatus {
  github: boolean;
  password: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user: UserProfile;
}

// ============================================================================
// Tag Types
// ============================================================================

export interface Tag {
  id: number;
  name: string;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface TagDetail extends Tag {
  feeds: Feed[];
}

// ============================================================================
// Comment Types
// ============================================================================

export interface Comment {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** 登录用户的评论 */
  user?: {
    id: number;
    username: string;
    avatar: string | null;
    permission: number | null;
  } | null;
  /** 游客评论的昵称 */
  guestName?: string;
  /** 游客评论的邮箱 */
  guestEmail?: string;
  /** 游客评论的网站 */
  guestWebsite?: string;
  /** 审核状态 */
  approved: boolean;
}

export interface CreateCommentRequest {
  content: string;
  /** 游客昵称（未登录时必填） */
  guestName?: string;
  /** 游客邮箱（可选） */
  guestEmail?: string;
  /** 游客网站（可选） */
  guestWebsite?: string;
}

// ============================================================================
// Friend Types
// ============================================================================

export interface Friend {
  id: number;
  name: string;
  desc: string | null;
  avatar: string;
  url: string;
  accepted: number;
  sort_order: number | null;
  createdAt: string;
  uid: number;
  updatedAt: string;
  health: string;
}

export interface FriendListResponse {
  friend_list: Friend[];
  apply_list: Friend | null;
}

export interface CreateFriendRequest {
  name: string;
  desc: string;
  avatar: string;
  url: string;
}

export interface UpdateFriendRequest {
  name: string;
  desc: string;
  avatar?: string;
  url: string;
  accepted?: number;
  sort_order?: number;
}

// ============================================================================
// Domain Verification File Types
// ============================================================================

export interface VerificationFile {
  id: number;
  /** Public request pathname, e.g. "/google123.txt" or "/.well-known/google123.txt" */
  path: string;
  /** Plain-text body served for the path */
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationFileListResponse {
  list: VerificationFile[];
}

export interface CreateVerificationFileRequest {
  path: string;
  content: string;
}

export interface UpdateVerificationFileRequest {
  path: string;
  content: string;
}

// ============================================================================
// Moment Types
// ============================================================================

export interface Moment {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: number;
    username: string;
    avatar: string;
  };
}

export interface CreateMomentRequest {
  content: string;
}

export interface MomentListResponse {
  data: Moment[];
  hasNext: boolean;
}

// ============================================================================
// Showcase Types (展柜)
// ============================================================================

export interface ShowcaseItem {
  id: number;
  showcaseId: number;
  title: string;
  /** Ordered image URL list; the first image is the card cover */
  images: string[];
  desc: string;
  sort_order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShowcaseGroup {
  id: number;
  name: string;
  sort_order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShowcaseGroupWithItems extends ShowcaseGroup {
  items: ShowcaseItem[];
}

export interface ShowcaseListResponse {
  showcases: ShowcaseGroupWithItems[];
}

export interface CreateShowcaseRequest {
  name: string;
}

export interface UpdateShowcaseRequest {
  name: string;
}

export interface ShowcaseReorderRequest {
  ids: number[];
}

export interface CreateShowcaseItemRequest {
  title?: string;
  images?: string[];
  desc?: string;
}

export interface UpdateShowcaseItemRequest {
  title?: string;
  images?: string[];
  desc?: string;
  /** Move the item into another showcase group */
  showcaseId?: number;
}

// ============================================================================
// Config Types
// ============================================================================

export type ConfigType = 'client' | 'server';

export interface ConfigResponse {
  [key: string]: any;
}

// ============================================================================
// AI Config Types
// ============================================================================

export interface AIConfig {
  enabled: boolean;
  provider: string;
  model: string;
  api_key: string;
  api_url: string;
}

// ============================================================================
// Bangumi Types
// ============================================================================

/** 收藏类型: 1=想看, 2=看过, 3=在看, 4=搁置, 5=抛弃 */
export type CollectionType = 1 | 2 | 3 | 4 | 5;

/** 条目类型: 1=书籍, 2=动画, 3=音乐, 4=游戏, 6=三次元 */
export type SubjectType = 1 | 2 | 3 | 4 | 6;

export interface SubjectImages {
  large: string;
  common: string;
  medium: string;
  small: string;
  grid: string;
}

export interface SubjectTag {
  name: string;
  count: number;
}

export interface SlimSubject {
  id: number;
  type: SubjectType;
  name: string;
  name_cn: string;
  short_summary: string;
  date?: string | null;
  images: SubjectImages;
  volumes: number;
  eps: number;
  collection_total: number;
  score: number;
  rank: number;
  tags: SubjectTag[];
}

export interface UserSubjectCollection {
  subject_id: number;
  subject_type: SubjectType;
  rate: number;
  type: CollectionType;
  comment?: string | null;
  tags: string[];
  ep_status: number;
  vol_status: number;
  updated_at: string;
  private: boolean;
  subject: SlimSubject;
}

export interface UserSubjectCollectionResponse {
  data: UserSubjectCollection[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface UploadResponse {
  success: boolean;
  url: string;
}

/** One stored image, as listed for the editor image picker. */
export interface StorageImageItem {
  key: string;
  url: string;
  size: number;
  /** ISO timestamp of the upload. */
  uploadedAt: string;
}

export interface StorageImageListResponse {
  success: boolean;
  items: StorageImageItem[];
  /** Offset cursor for the next page, or null when the list is exhausted. */
  cursor: string | null;
  /** Total number of indexed images. */
  total: number;
}

// ============================================================================
// Search Types
// ============================================================================

// Uses FeedListResponse

// ============================================================================
// WordPress Import Types
// ============================================================================

export interface WordPressImportResponse {
  success: number;
  skipped: number;
  skippedList: Array<{ title: string; reason: string }>;
}

// ============================================================================
// Tools Types (X media downloader / comic downloader)
// ============================================================================

/** Kind of media attached to an X (Twitter) post. */
export type XMediaKind = 'video' | 'gif' | 'photo';

/** One downloadable variant of a media item (different bitrate / resolution). */
export interface XMediaVariant {
  url: string;
  container: string;
  bitrate?: number;
  label?: string;
}

export interface XMediaItem {
  id: string;
  kind: XMediaKind;
  /** Direct CDN url of the downloadable file (mp4 for video/gif, image for photo). */
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** Best-effort human readable label, e.g. "720x720 · 60s". */
  label?: string;
  variants: XMediaVariant[];
}

export interface XTweetMediaResponse {
  tweetId: string;
  url: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  text: string;
  createdAt?: string;
  /** Which upstream resolver produced the payload. */
  source: string;
  media: XMediaItem[];
}

/** One entry of the comic platform selector (only `enabled` ones can be used). */
export interface ComicPlatform {
  id: string;
  name: string;
  enabled: boolean;
  homepage: string;
  note?: string;
}

export interface ComicPlatformListResponse {
  platforms: ComicPlatform[];
}

export interface ComicChapter {
  id: string;
  title: string;
  /** Currently readable for free (無料 / campaign / trial). */
  free: boolean;
  /** The chapter the user submitted. */
  current: boolean;
}

export interface ComicResolveResponse {
  platform: string;
  episodeId: string;
  episodeTitle: string;
  seriesId?: string;
  seriesTitle?: string;
  chapters: ComicChapter[];
}

export interface ComicPage {
  url: string;
  /** Block order for the 4x4 image scramble, or null when the page is not scrambled. */
  scramble: number[] | null;
  sort: number;
  width?: number;
  height?: number;
}

export interface ComicPagesResponse {
  platform: string;
  episodeId: string;
  episodeTitle: string;
  pages: ComicPage[];
}

// ============================================================================
// API Endpoint Paths
// ============================================================================

export const API_PATHS = {
  // Feed
  FEED_LIST: '/api/feed',
  FEED_TIMELINE: '/api/feed/timeline',
  FEED_GET: (id: number | string) => `/api/feed/${id}`,
  FEED_CREATE: '/api/feed',
  FEED_UPDATE: (id: number) => `/api/feed/${id}`,
  FEED_DELETE: (id: number) => `/api/feed/${id}`,
  FEED_ADJACENT: (id: number | string) => `/api/feed/adjacent/${id}`,
  FEED_SET_TOP: (id: number) => `/api/feed/top/${id}`,

  // Auth
  AUTH_STATUS: '/api/auth/status',
  AUTH_LOGIN: '/api/auth/login',

  // User
  USER_PROFILE: '/api/user/profile',
  USER_UPDATE_PROFILE: '/api/user/profile',
  USER_LOGOUT: '/api/user/logout',
  USER_GITHUB: '/api/user/github',

  // Tag
  TAG_LIST: '/api/tag',
  TAG_GET: (name: string) => `/api/tag/${encodeURIComponent(name)}`,

  // Comment
  COMMENT_LIST: (feedId: number) => `/api/comment/${feedId}`,
  COMMENT_CREATE: (feedId: number) => `/api/comment/${feedId}`,
  COMMENT_DELETE: (id: number) => `/api/comment/${id}`,

  // Friend
  FRIEND_LIST: '/api/friend',
  FRIEND_CREATE: '/api/friend',
  FRIEND_UPDATE: (id: number) => `/api/friend/${id}`,
  FRIEND_DELETE: (id: number) => `/api/friend/${id}`,

  // Moments
  MOMENTS_LIST: '/api/moments',
  MOMENTS_CREATE: '/api/moments',
  MOMENTS_UPDATE: (id: number) => `/api/moments/${id}`,
  MOMENTS_DELETE: (id: number) => `/api/moments/${id}`,

  // Config
  CONFIG_GET: (type: ConfigType) => `/config/${type}`,
  CONFIG_UPDATE: (type: ConfigType) => `/config/${type}`,
  CONFIG_CLEAR_CACHE: '/config/cache',

  // AI Config (deprecated - use CONFIG_GET/CONFIG_UPDATE with 'server' type instead)
  /** @deprecated Use CONFIG_GET('server') instead. AI config is now part of server config. */
  AI_CONFIG_GET: '/ai-config',
  /** @deprecated Use CONFIG_UPDATE('server', {...}) instead. AI config is now part of server config. */
  AI_CONFIG_UPDATE: '/ai-config',

  // Storage
  STORAGE_UPLOAD: '/storage',

  // Favicon
  FAVICON_GET: '/favicon',
  FAVICON_GET_ORIGINAL: '/favicon/original',
  FAVICON_UPLOAD: '/favicon',

  // Search
  SEARCH: (keyword: string) => `/search/${encodeURIComponent(keyword)}`,

  // WordPress
  WP_IMPORT: '/wp',

  // RSS
  RSS_GET: (name: string) => `/${encodeURIComponent(name)}`,

  // Tools
  TOOLS_X_MEDIA: '/api/tools/x/media',
  TOOLS_X_PROXY: '/api/tools/x/proxy',
  TOOLS_COMIC_PLATFORMS: '/api/tools/comics/platforms',
  TOOLS_COMIC_RESOLVE: (platform: string) => `/api/tools/comics/${platform}/resolve`,
  TOOLS_COMIC_PAGES: (platform: string) => `/api/tools/comics/${platform}/pages`,
  TOOLS_COMIC_IMAGE: (platform: string) => `/api/tools/comics/${platform}/image`,
} as const;

export type APIEndpoint = typeof API_PATHS;
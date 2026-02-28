/**
 * Metricool API Client
 *
 * Handles authentication and API requests to Metricool.
 * API Reference: https://help.metricool.com/en/article/basic-guide-for-api-integration-abukgf/
 */

export interface MetricoolConfig {
  token: string;
  userId: string;
}

export interface SchedulePostParams {
  brandId: string;
  text: string;
  dateTime: string;
  timezone?: string;
  network?: string;
  imageUrl?: string;
}

export interface AnalyticsParams {
  brandId: string;
  startDate?: string;
  endDate?: string;
}

export interface ScheduledPost {
  id: number;
  uuid: string;
  text: string;
  publicationDate: {
    dateTime: string;
    timezone: string;
  };
  providers: Array<{
    network: string;
    status: string;
    detailedStatus: string;
    publicUrl?: string;
  }>;
  draft: boolean;
}

// Raw post data from Metricool API
export interface LinkedInPost {
  id?: string;
  postId?: string;
  text?: string;
  content?: string;
  publishedAt?: string;
  date?: string;
  impressions?: number;
  engagements?: number;
  engagement?: number;
  clicks?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reactions?: number;
}

export interface Brand {
  id: number;
  label: string;
  twitter?: string;
  facebook?: string;
  instagram?: string;
  linkedinCompany?: string;
  youtube?: string;
  tiktok?: string;
  threads?: string;
  bluesky?: string;
}

export interface BestTimeSlot {
  dayOfWeek: number;
  hour: number;
  score: number;
}

export class MetricoolClient {
  private baseUrl = "https://app.metricool.com/api";
  private token: string;
  private userId: string;

  constructor(config: MetricoolConfig) {
    this.token = config.token;
    this.userId = config.userId;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "X-Mc-Auth": this.token,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Metricool API error (${response.status}): ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get all brands/accounts connected to Metricool
   */
  async getBrands(): Promise<Brand[]> {
    return this.request<Brand[]>(`/admin/simpleProfiles?userId=${this.userId}`);
  }

  /**
   * Schedule a post to a social network via Metricool
   */
  async schedulePost(params: SchedulePostParams): Promise<ScheduledPost> {
    const network = params.network || "linkedin";

    const body: Record<string, unknown> = {
      text: params.text,
      publicationDate: {
        dateTime: params.dateTime,
        timezone: params.timezone || "America/Costa_Rica",
      },
      providers: [{ network }],
      autoPublish: true,
      linkedinData: network === "linkedin" ? { previewIncluded: true, type: "POST" } : undefined,
    };

    if (params.imageUrl) {
      body.media = [params.imageUrl];
    }

    const queryParams = new URLSearchParams({
      userId: this.userId,
      blogId: params.brandId,
    });

    const response = await this.request<{ data: ScheduledPost }>(`/v2/scheduler/posts?${queryParams}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return response.data;
  }

  /**
   * Get scheduled posts for a brand
   */
  async getScheduledPosts(brandId: string): Promise<ScheduledPost[]> {
    // Get posts for next 60 days by default
    const now = new Date();
    const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const formatDateTime = (d: Date) => d.toISOString().slice(0, 19);

    const params = new URLSearchParams({
      userId: this.userId,
      blogId: brandId,
      start: formatDateTime(now),
      end: formatDateTime(sixtyDaysFromNow),
      timezone: "America/Costa_Rica",
    });

    const response = await this.request<{ data: ScheduledPost[] }>(`/v2/scheduler/posts?${params}`);
    return response.data || [];
  }

  /**
   * Get analytics for LinkedIn posts
   */
  async getAnalytics(params: AnalyticsParams): Promise<LinkedInPost[]> {
    // Default to last 30 days if no dates provided (API requires dates)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const formatDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

    const startDate = params.startDate
      ? params.startDate.replace(/-/g, "")
      : formatDate(thirtyDaysAgo);
    const endDate = params.endDate
      ? params.endDate.replace(/-/g, "")
      : formatDate(now);

    const searchParams = new URLSearchParams({
      userId: this.userId,
      blogId: params.brandId,
      start: startDate,
      end: endDate,
    });

    return this.request<LinkedInPost[]>(
      `/stats/linkedin/posts?${searchParams}`
    );
  }

  /**
   * Get best times to post on LinkedIn based on historical engagement
   */
  async getBestTime(brandId: string): Promise<BestTimeSlot[]> {
    const params = new URLSearchParams({
      userId: this.userId,
      blogId: brandId,
    });

    const response = await this.request<{ data: BestTimeSlot[] }>(`/v2/scheduler/besttimes/linkedin?${params}`);
    return response.data || [];
  }

  /**
   * Delete a scheduled post
   */
  async deleteScheduledPost(postId: string): Promise<void> {
    await this.request(`/scheduler/post/${postId}?userId=${this.userId}`, {
      method: "DELETE",
    });
  }
}

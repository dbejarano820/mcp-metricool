#!/usr/bin/env node

/**
 * Metricool MCP Server
 *
 * Provides tools for scheduling LinkedIn posts and querying analytics
 * via the Metricool API.
 *
 * Environment Variables:
 * - METRICOOL_TOKEN: Your Metricool API token
 * - METRICOOL_USER_ID: Your Metricool user ID
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MetricoolClient, LinkedInPost } from "./client.js";

// Validate environment variables
const METRICOOL_TOKEN = process.env.METRICOOL_TOKEN;
const METRICOOL_USER_ID = process.env.METRICOOL_USER_ID;

if (!METRICOOL_TOKEN || !METRICOOL_USER_ID) {
  console.error(
    "Error: METRICOOL_TOKEN and METRICOOL_USER_ID environment variables are required"
  );
  process.exit(1);
}

// Initialize client
const client = new MetricoolClient({
  token: METRICOOL_TOKEN,
  userId: METRICOOL_USER_ID,
});

// Initialize MCP server
const server = new Server(
  {
    name: "metricool",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const TOOLS = [
  {
    name: "metricool_get_brands",
    description: "List all brands/accounts connected to Metricool. Returns brand IDs needed for other operations.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "metricool_schedule_post",
    description: "Schedule a LinkedIn post via Metricool. Returns the scheduled post ID and details.",
    inputSchema: {
      type: "object" as const,
      properties: {
        brandId: { type: "string", description: "The Metricool brand/account ID to post from" },
        text: { type: "string", description: "The post content (LinkedIn text post)" },
        dateTime: { type: "string", description: "Scheduled date/time in ISO 8601 format (e.g., 2024-01-15T10:00:00)" },
        timezone: { type: "string", description: "Timezone for the scheduled time (default: America/Costa_Rica)" },
        imageUrl: { type: "string", description: "Optional URL to an image to include with the post" },
      },
      required: ["brandId", "text", "dateTime"],
    },
  },
  {
    name: "metricool_get_scheduled_posts",
    description: "Get all scheduled posts for a brand from Metricool. Shows pending posts in the queue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        brandId: { type: "string", description: "The Metricool brand/account ID" },
      },
      required: ["brandId"],
    },
  },
  {
    name: "metricool_get_analytics",
    description: "Get LinkedIn post performance metrics from Metricool. Returns impressions, engagements, top posts, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        brandId: { type: "string", description: "The Metricool brand/account ID" },
        startDate: { type: "string", description: "Start date for analytics range (YYYY-MM-DD format)" },
        endDate: { type: "string", description: "End date for analytics range (YYYY-MM-DD format)" },
      },
      required: ["brandId"],
    },
  },
  {
    name: "metricool_get_best_time",
    description: "Get optimal posting times for LinkedIn based on historical audience engagement patterns.",
    inputSchema: {
      type: "object" as const,
      properties: {
        brandId: { type: "string", description: "The Metricool brand/account ID" },
      },
      required: ["brandId"],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = args as Record<string, string | undefined>;

  try {
    switch (name) {
      case "metricool_get_brands": {
        const brands = await client.getBrands();
        const formattedBrands = brands.map((b) => ({
          id: String(b.id),
          name: b.label,
          networks: [
            b.linkedinCompany && "linkedin",
            b.twitter && "twitter",
            b.facebook && "facebook",
            b.instagram && "instagram",
            b.youtube && "youtube",
            b.tiktok && "tiktok",
            b.threads && "threads",
            b.bluesky && "bluesky",
          ].filter(Boolean),
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true, brands: formattedBrands }, null, 2) }],
        };
      }

      case "metricool_schedule_post": {
        const result = await client.schedulePost({
          brandId: typedArgs.brandId!,
          text: typedArgs.text!,
          dateTime: typedArgs.dateTime!,
          timezone: typedArgs.timezone || "America/Costa_Rica",
          imageUrl: typedArgs.imageUrl,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: "Post scheduled successfully",
                postId: result.id,
                uuid: result.uuid,
                scheduledDate: result.publicationDate?.dateTime,
                networks: result.providers?.map((p) => p.network) || [],
              }, null, 2),
            },
          ],
        };
      }

      case "metricool_get_scheduled_posts": {
        const posts = await client.getScheduledPosts(typedArgs.brandId!);
        // Filter to only pending posts (not published)
        const pendingPosts = posts.filter((p) =>
          p.providers.some((prov) => prov.status === "PENDING")
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                count: pendingPosts.length,
                posts: pendingPosts.map((p) => ({
                  id: p.id,
                  uuid: p.uuid,
                  text: p.text.substring(0, 100) + (p.text.length > 100 ? "..." : ""),
                  scheduledDate: p.publicationDate.dateTime,
                  timezone: p.publicationDate.timezone,
                  networks: p.providers.map((prov) => prov.network),
                  status: p.providers[0]?.detailedStatus || "Unknown",
                })),
              }, null, 2),
            },
          ],
        };
      }

      case "metricool_get_analytics": {
        const posts = await client.getAnalytics({
          brandId: typedArgs.brandId!,
          startDate: typedArgs.startDate,
          endDate: typedArgs.endDate,
        });

        // Aggregate stats from posts
        type Totals = { impressions: number; engagements: number; clicks: number; likes: number; comments: number; shares: number };
        const totals = posts.reduce(
          (acc: Totals, p: LinkedInPost) => ({
            impressions: acc.impressions + (p.impressions || 0),
            engagements: acc.engagements + (p.engagements || p.engagement || 0),
            clicks: acc.clicks + (p.clicks || 0),
            likes: acc.likes + (p.likes || p.reactions || 0),
            comments: acc.comments + (p.comments || 0),
            shares: acc.shares + (p.shares || 0),
          }),
          { impressions: 0, engagements: 0, clicks: 0, likes: 0, comments: 0, shares: 0 }
        );

        const engagementRate = totals.impressions > 0
          ? ((totals.engagements / totals.impressions) * 100).toFixed(2)
          : "0.00";

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                summary: {
                  impressions: totals.impressions,
                  engagements: totals.engagements,
                  engagementRate: `${engagementRate}%`,
                  clicks: totals.clicks,
                  likes: totals.likes,
                  comments: totals.comments,
                  shares: totals.shares,
                },
                postCount: posts.length,
                topPosts: [...posts]
                  .sort((a, b) => (b.engagements || b.engagement || 0) - (a.engagements || a.engagement || 0))
                  .slice(0, 5)
                  .map((p) => {
                    const text = p.text || p.content || "";
                    return {
                      id: p.id || p.postId,
                      text: text.substring(0, 80) + (text.length > 80 ? "..." : ""),
                      publishedAt: p.publishedAt || p.date,
                      impressions: p.impressions || 0,
                      engagements: p.engagements || p.engagement || 0,
                    };
                  }),
              }, null, 2),
            },
          ],
        };
      }

      case "metricool_get_best_time": {
        const slots = await client.getBestTime(typedArgs.brandId!);
        const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const formatHour = (hour: number): string => {
          const suffix = hour >= 12 ? "PM" : "AM";
          const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
          return `${displayHour}:00 ${suffix}`;
        };
        const sortedSlots = [...slots].sort((a, b) => b.score - a.score);
        const topSlots = sortedSlots.slice(0, 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                recommendation: "Based on your audience engagement patterns, here are the best times to post:",
                topSlots: topSlots.map((s) => ({
                  day: DAYS_OF_WEEK[s.dayOfWeek],
                  time: formatHour(s.hour),
                  score: s.score,
                })),
              }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Metricool MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

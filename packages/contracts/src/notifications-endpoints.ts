import type { ControlEndpoint } from "./http-endpoints.js";
import {
  CreateNotificationChannel,
  NotificationChannel,
  NotificationChannelOverview,
  RemoveNotificationChannel,
  TestNotificationChannel,
} from "./notifications.js";

const owner = "owner" as const;
export const NOTIFICATION_HTTP_ENDPOINTS = [
  {
    method: "GET",
    path: "/notifications/channels",
    operationId: "notificationChannels",
    response: NotificationChannelOverview,
    success: 200,
    access: owner,
  },
  {
    method: "POST",
    path: "/notifications/channels",
    operationId: "createNotificationChannel",
    request: CreateNotificationChannel,
    response: NotificationChannel,
    success: 201,
    access: owner,
    idempotent: true,
  },
  {
    method: "POST",
    path: "/notifications/channels/:id/test",
    operationId: "testNotificationChannel",
    request: TestNotificationChannel,
    response: NotificationChannel,
    success: 200,
    access: owner,
    idempotent: true,
  },
  {
    method: "POST",
    path: "/notifications/channels/:id/remove",
    operationId: "removeNotificationChannel",
    request: RemoveNotificationChannel,
    response: NotificationChannel,
    success: 200,
    access: owner,
    idempotent: true,
  },
] as const satisfies readonly ControlEndpoint[];

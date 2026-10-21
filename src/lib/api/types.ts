/**
 * Friendly names for the generated API types (schema.d.ts, `npm run api:types`).
 * Import API shapes from here rather than reaching into `components['schemas']`.
 */
import type { components, paths } from './schema';

export type { components, paths };

type Schemas = components['schemas'];

// — enums —
export type TaskStatus = Schemas['TaskStatus'];
export type TaskPriority = Schemas['TaskPriority'];
export type ProjectRole = Schemas['ProjectRole'];
export type InvitationStatus = Schemas['InvitationStatus'];
export type NotificationType = Schemas['NotificationType'];
/** Roles an invitation can grant (never OWNER). */
export type InvitationRole = Schemas['Invitation']['role'];

// — users —
/** The signed-in user (GET/PATCH /users/me, register, login). */
export type User = Schemas['User'];
/** `{ id, name }` — authors, uploaders, list-view assignees. */
export type UserSummary = Schemas['UserSummary'];
/** `{ id, name, email }` — task-detail assignee / creator, project owner. */
export type UserContact = Schemas['UserContact'];

// — auth —
export type LoginResult = Schemas['LoginResult'];
export type AuthTokens = Schemas['AuthTokens'];

// — projects & members —
/**
 * A project in the list (GET /projects). The spec calls this `ProjectSummary`; its `Project`
 * schema is the detail shape, aliased below as `ProjectDetail`.
 */
export type Project = Schemas['ProjectSummary'];
/** GET/POST/PATCH /projects/{id}: the list fields plus `owner`. */
export type ProjectDetail = Schemas['Project'];
export type Member = Schemas['Member'];

// — invitations —
/** An invitation as the project sees it (GET /projects/{id}/invitations). */
export type Invitation = Schemas['Invitation'];
/** An invitation in my inbox (GET /users/me/invitations): adds `project { id, name }`. */
export type MyInvitation = Schemas['MyInvitation'];
export type InvitationAcceptance = Schemas['InvitationAcceptance'];

// — tasks —
/** GET/POST/PATCH /projects/{id}/tasks/{taskId}: contact-level people plus comment/attachment counts. */
export type Task = Schemas['Task'];
/** A row of GET /projects/{id}/tasks. */
export type TaskListItem = Schemas['TaskListItem'];
/** A row of GET /users/me/tasks: adds `project { id, name }`. */
export type MyTaskListItem = Schemas['MyTaskListItem'];
export type TaskDescription = Schemas['TaskDescription'];

// — comments, attachments, notifications —
export type Comment = Schemas['Comment'];
/** GET /projects/{id}/comments/{commentId}: adds the `task` and `project` it belongs to. */
export type CommentDetail = Schemas['CommentDetail'];
export type Attachment = Schemas['Attachment'];
/** `payload` is untyped in the spec (`Record<string, unknown>`); narrow it per `type`. */
export type Notification = Schemas['Notification'];

// — envelopes —
export type PageMeta = Schemas['PageMeta'];
/** PageMeta plus `unreadCount` (GET /notifications). */
export type NotificationPageMeta = Schemas['NotificationPageMeta'];
/** The error response body: `{ error: { code, message, details?, requestId } }`. */
export type ApiErrorBody = Schemas['Error'];
/** One entry of `error.details` (422 validation): `{ path, message }`. */
export type ApiErrorDetail = NonNullable<ApiErrorBody['error']['details']>[number];

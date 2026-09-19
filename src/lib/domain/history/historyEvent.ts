export type HistoryActorKind = 'OWNER' | 'SYSTEM';

export type HistoryEventType =
	| 'FIELD_CHANGED'
	| 'ATTACHMENT_ADDED'
	| 'ATTACHMENT_REMOVED'
	| 'ACTION_COMPLETED'
	| 'ACTION_SKIPPED'
	| 'ACTION_ADDED'
	| 'ACTION_DUE_OVERRIDE_SET'
	| 'ACTION_DUE_OVERRIDE_CLEARED'
	| 'CYCLE_STARTED'
	| 'CYCLE_COMPLETED'
	| 'ITEM_ARCHIVED'
	| 'ITEM_UNARCHIVED'
	| 'RELATION_LINKED'
	| 'RELATION_UNLINKED'
	| 'AI_SUGGESTIONS_ACCEPTED'
	| 'CUSTOM_FIELD_ADDED'
	| 'CUSTOM_FIELD_REMOVED';

export interface FieldChangedPayload {
	fieldKey: string;
}

export interface AttachmentPayload {
	attachmentId: string;
}

export interface ActionPayload {
	actionId: string;
}

export interface ActionDueOverridePayload {
	actionId: string;
}

export interface CyclePayload {
	cycleId: string;
	sequence: number;
}

export interface RelationPayload {
	relatedItemId: string;
}

export interface AiSuggestionsAcceptedPayload {
	acceptedCount: number;
}

export interface CustomFieldPayload {
	fieldKey: string;
}

export type HistoryEventPayload =
	| FieldChangedPayload
	| AttachmentPayload
	| ActionPayload
	| ActionDueOverridePayload
	| CyclePayload
	| RelationPayload
	| AiSuggestionsAcceptedPayload
	| CustomFieldPayload
	| Record<string, never>;

export interface ItemHistoryEvent {
	id: string;
	itemId: string;
	actorKind: HistoryActorKind;
	eventType: HistoryEventType;
	payload: string;
	createdAt: string;
}

export const ALLOWED_EVENT_TYPES: readonly HistoryEventType[] = [
	'FIELD_CHANGED',
	'ATTACHMENT_ADDED',
	'ATTACHMENT_REMOVED',
	'ACTION_COMPLETED',
	'ACTION_SKIPPED',
	'ACTION_ADDED',
	'ACTION_DUE_OVERRIDE_SET',
	'ACTION_DUE_OVERRIDE_CLEARED',
	'CYCLE_STARTED',
	'CYCLE_COMPLETED',
	'ITEM_ARCHIVED',
	'ITEM_UNARCHIVED',
	'RELATION_LINKED',
	'RELATION_UNLINKED',
	'AI_SUGGESTIONS_ACCEPTED',
	'CUSTOM_FIELD_ADDED',
	'CUSTOM_FIELD_REMOVED'
] as const;

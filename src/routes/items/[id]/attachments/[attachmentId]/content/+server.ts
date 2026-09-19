import { error } from '@sveltejs/kit';
import { getAttachmentForDownload } from '$lib/application/attachments/attachments';
import { attachmentStoragePort, attachmentsPort, itemsPort } from '$lib/server/appPorts';
import { attachmentContentHeaders } from '$lib/server/http/attachmentContentHeaders';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals, url }) => {
	if (!locals.user) error(403);
	const found = getAttachmentForDownload(
		{ items: itemsPort, attachments: attachmentsPort, storage: attachmentStoragePort },
		params.id,
		params.attachmentId
	);
	if (!found) error(404);
	return new Response(found.stream, {
		headers: attachmentContentHeaders(found.attachment, url.searchParams.get('download') === '1')
	});
};

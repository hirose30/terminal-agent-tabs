import { describe, it, expect } from 'vitest';
import { classifyHookEvent, parseHookLine, resolveHookSessionId } from '../HookEventMonitor';

describe('classifyHookEvent()', () => {
	it('classifies "notification" event as needs_input', () => {
		const result = classifyHookEvent('notification', 'some message');
		expect(result.notificationType).toBe('needs_input');
		expect(result.soundKind).toBe('action');
	});

	it('classifies "stop" event as task_complete', () => {
		const result = classifyHookEvent('stop', 'Task finished');
		expect(result.notificationType).toBe('task_complete');
		expect(result.soundKind).toBe('complete');
	});

	it('classifies event containing "permission" as action_needed', () => {
		const result = classifyHookEvent('PreToolUse', 'Requesting permission to run bash');
		expect(result.notificationType).toBe('action_needed');
		expect(result.notificationTitle).toBe('Permission');
		expect(result.soundKind).toBe('action');
	});

	it('classifies event containing "approve" as action_needed', () => {
		const result = classifyHookEvent('tool_call', 'Please approve this action');
		expect(result.notificationType).toBe('action_needed');
	});

	it('classifies event containing "error" as action_needed', () => {
		const result = classifyHookEvent('tool_error', 'Command failed with error');
		expect(result.notificationType).toBe('action_needed');
		expect(result.notificationTitle).toBe('Error');
	});

	it('classifies event containing "failed" as action_needed', () => {
		const result = classifyHookEvent('event', 'Process failed to start');
		expect(result.notificationType).toBe('action_needed');
	});

	it('classifies event containing "completed" as task_complete', () => {
		const result = classifyHookEvent('event', 'Task completed successfully');
		expect(result.notificationType).toBe('task_complete');
		expect(result.soundKind).toBe('complete');
	});

	it('classifies event containing "done" as task_complete', () => {
		const result = classifyHookEvent('event', 'All done');
		expect(result.notificationType).toBe('task_complete');
	});

	it('classifies event containing "waiting" as action_needed', () => {
		const result = classifyHookEvent('event', 'Waiting for user input');
		expect(result.notificationType).toBe('action_needed');
		expect(result.notificationTitle).toBe('Waiting');
	});

	it('classifies event containing "hitl" as action_needed', () => {
		const result = classifyHookEvent('hitl', 'Human in the loop required');
		expect(result.notificationType).toBe('action_needed');
	});

	it('classifies unknown event as agent_event', () => {
		const result = classifyHookEvent('some_unknown_event', 'Random output');
		expect(result.notificationType).toBe('agent_event');
		expect(result.soundKind).toBe('event');
	});

	it('is case-insensitive for event type matching', () => {
		const result = classifyHookEvent('NOTIFICATION', 'msg');
		expect(result.notificationType).toBe('needs_input');
	});

	it('is case-insensitive for message matching', () => {
		const result = classifyHookEvent('event', 'PERMISSION REQUIRED');
		expect(result.notificationType).toBe('action_needed');
	});
});

describe('parseHookLine()', () => {
	it('parses a real-shape Notification line with session_id and notification_type', () => {
		const line = JSON.stringify({
			session_id: '8376e8e9-eb69-4f04-ab04-fd9d4b8aad48',
			hook_event_name: 'Notification',
			message: 'Claude needs your permission',
			notification_type: 'permission_prompt',
			hook: 'notification'
		});
		const event = parseHookLine(line);
		expect(event).not.toBeNull();
		expect(event!.notificationType).toBe('needs_input');
		expect(event!.agentSessionId).toBe('8376e8e9-eb69-4f04-ab04-fd9d4b8aad48');
		expect(event!.rawNotificationType).toBe('permission_prompt');
		expect(event!.message).toBe('Claude needs your permission');
	});

	it('parses an idle_prompt notification_type', () => {
		const event = parseHookLine(JSON.stringify({
			session_id: 'abc',
			hook: 'notification',
			message: 'Claude is waiting for your input',
			notification_type: 'idle_prompt'
		}));
		expect(event!.rawNotificationType).toBe('idle_prompt');
	});

	it('leaves agentSessionId and rawNotificationType undefined when absent (old relay lines)', () => {
		const event = parseHookLine(JSON.stringify({
			hook: 'notification',
			message: 'needs input'
		}));
		expect(event).not.toBeNull();
		expect(event!.agentSessionId).toBeUndefined();
		expect(event!.rawNotificationType).toBeUndefined();
	});

	it('ignores non-string session_id / notification_type values', () => {
		const event = parseHookLine(JSON.stringify({
			hook: 'notification',
			message: 'm',
			session_id: 42,
			notification_type: { nested: true }
		}));
		expect(event!.agentSessionId).toBeUndefined();
		expect(event!.rawNotificationType).toBeUndefined();
	});

	it('treats empty-string session_id as absent', () => {
		const event = parseHookLine(JSON.stringify({
			hook: 'notification',
			message: 'm',
			session_id: '  '
		}));
		expect(event!.agentSessionId).toBeUndefined();
	});

	it('classifies a Stop line as task_complete and carries its session_id', () => {
		const event = parseHookLine(JSON.stringify({
			session_id: 'abc',
			hook: 'stop',
			hook_event_name: 'Stop'
		}));
		expect(event!.notificationType).toBe('task_complete');
		expect(event!.agentSessionId).toBe('abc');
	});

	it('parses tool_name from a PreToolUse line', () => {
		const event = parseHookLine(JSON.stringify({
			session_id: 'abc',
			hook: 'pre-tool-use',
			hook_event_name: 'PreToolUse',
			tool_name: 'AskUserQuestion'
		}));
		expect(event).not.toBeNull();
		expect(event!.toolName).toBe('AskUserQuestion');
		expect(event!.agentSessionId).toBe('abc');
	});

	it('leaves toolName undefined when tool_name is absent', () => {
		const event = parseHookLine(JSON.stringify({
			hook: 'notification',
			message: 'm'
		}));
		expect(event!.toolName).toBeUndefined();
	});

	it('ignores a non-string tool_name', () => {
		const event = parseHookLine(JSON.stringify({
			hook: 'pre-tool-use',
			tool_name: ['AskUserQuestion']
		}));
		expect(event!.toolName).toBeUndefined();
	});

	it('returns null for invalid JSON and non-object JSON', () => {
		expect(parseHookLine('not json')).toBeNull();
		expect(parseHookLine('42')).toBeNull();
		expect(parseHookLine('null')).toBeNull();
	});

	it('parses tat_session_id emitted by the relay --tat-session flag', () => {
		const event = parseHookLine(JSON.stringify({
			session_id: 'claude-side-id',
			tat_session_id: 'tat-side-id',
			hook: 'notification',
			message: 'm'
		}));
		expect(event!.tatSessionId).toBe('tat-side-id');
		expect(event!.agentSessionId).toBe('claude-side-id');
	});

	it('leaves tatSessionId undefined when absent (legacy relay lines)', () => {
		const event = parseHookLine(JSON.stringify({
			hook: 'notification',
			message: 'm'
		}));
		expect(event!.tatSessionId).toBeUndefined();
	});

	it('ignores a non-string tat_session_id', () => {
		const event = parseHookLine(JSON.stringify({
			hook: 'notification',
			message: 'm',
			tat_session_id: 7
		}));
		expect(event!.tatSessionId).toBeUndefined();
	});
});

describe('resolveHookSessionId()', () => {
	const resolver = (overrides: Partial<Parameters<typeof resolveHookSessionId>[1]> = {}) => ({
		hasSession: () => false,
		findByAgentSessionId: () => null,
		fallback: () => 'heuristic',
		...overrides
	});

	it('prefers a live tatSessionId over everything else', () => {
		const result = resolveHookSessionId(
			{ tatSessionId: 'tat-1', agentSessionId: 'agent-1' },
			resolver({
				hasSession: (id) => id === 'tat-1',
				findByAgentSessionId: () => 'other-session'
			})
		);
		expect(result).toBe('tat-1');
	});

	it('falls through to the agentSessionId reverse lookup when the tat session is gone', () => {
		const result = resolveHookSessionId(
			{ tatSessionId: 'tat-dead', agentSessionId: 'agent-1' },
			resolver({ findByAgentSessionId: (id) => (id === 'agent-1' ? 'matched' : null) })
		);
		expect(result).toBe('matched');
	});

	it('uses the reverse lookup when no tatSessionId is present (legacy lines)', () => {
		const result = resolveHookSessionId(
			{ agentSessionId: 'agent-1' },
			resolver({ findByAgentSessionId: () => 'matched' })
		);
		expect(result).toBe('matched');
	});

	it('falls back to the heuristic when the reverse lookup misses (resumed session)', () => {
		const result = resolveHookSessionId(
			{ agentSessionId: 'forked-new-id' },
			resolver()
		);
		expect(result).toBe('heuristic');
	});

	it('falls back to the heuristic when neither id is present', () => {
		expect(resolveHookSessionId({}, resolver())).toBe('heuristic');
	});
});

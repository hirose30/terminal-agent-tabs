import { describe, it, expect } from 'vitest';
import { classifyHookEvent } from '../HookEventMonitor';

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

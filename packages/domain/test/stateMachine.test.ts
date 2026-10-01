import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, assertTransition, InvalidTransitionError, nextStatuses } from '../src/orderStateMachine.ts';

test('happy path is allowed for the right actors', () => {
  const path = [['NEW','SEARCHING_DRIVER','SYSTEM'],['SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER'],['DRIVER_ASSIGNED','DRIVER_GOING_TO_PICKUP','DRIVER'],
    ['DRIVER_GOING_TO_PICKUP','DRIVER_ARRIVED_PICKUP','DRIVER'],['DRIVER_ARRIVED_PICKUP','PACKAGE_PICKED_UP','DRIVER'],['PACKAGE_PICKED_UP','IN_DELIVERY','DRIVER'],
    ['IN_DELIVERY','DRIVER_ARRIVED_DESTINATION','DRIVER'],['DRIVER_ARRIVED_DESTINATION','DELIVERED','DRIVER']] as const;
  for (const [f, t, a] of path) assert.ok(canTransition(f, t, a), `${f}->${t}`);
});

test('no skipping or random jumps', () => {
  assert.equal(canTransition('NEW', 'DELIVERED', 'DRIVER'), false);
  assert.equal(canTransition('SEARCHING_DRIVER', 'PACKAGE_PICKED_UP', 'DRIVER'), false);
  assert.throws(() => assertTransition('DELIVERED', 'CANCELLED', 'OPERATIONS'), InvalidTransitionError);
});

test('customer cannot cancel after pickup', () => {
  assert.equal(canTransition('PACKAGE_PICKED_UP', 'CANCELLED', 'CUSTOMER'), false);
  assert.equal(canTransition('IN_DELIVERY', 'CANCELLED', 'CUSTOMER'), false);
});

test('failure -> return flow', () => {
  assert.ok(canTransition('IN_DELIVERY', 'FAILED_DELIVERY', 'DRIVER'));
  assert.ok(canTransition('FAILED_DELIVERY', 'RETURNING', 'DRIVER'));
  assert.ok(canTransition('RETURNING', 'RETURNED', 'DRIVER'));
  assert.deepEqual(nextStatuses('RETURNED', 'OPERATIONS'), []);
});

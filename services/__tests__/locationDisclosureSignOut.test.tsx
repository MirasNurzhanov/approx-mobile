/**
 * The disclosure sheet after a sign-out, in the same run of the app.
 *
 * The sheet is mounted once in the root layout and outlives every account. A
 * sign-out resets the flag to unknown (`null`); the sheet only shows on
 * `false`, so unless the hook reads the flag again, the next account never sees
 * it, never acknowledges it, and `reportLocation` refuses to send a position
 * for the rest of the session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  acknowledgeLocationDisclosure,
  hasAcknowledgedLocationDisclosure,
  resetLocationDisclosure,
  useLocationDisclosure,
} from '../locationDisclosure';

let seen: boolean | null | undefined;

function Probe() {
  seen = useLocationDisclosure().acknowledged;
  return null;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await resetLocationDisclosure();
  seen = undefined;
});

it('is due again for the next account after a sign-out', async () => {
  await acknowledgeLocationDisclosure();
  let renderer: ReactTestRenderer;
  await act(async () => { renderer = create(<Probe />); });
  expect(seen).toBe(true);

  await act(async () => { await resetLocationDisclosure(); });

  expect(seen).toBe(false);
  await act(async () => { renderer.unmount(); });
});

it('is shown on a fresh install', async () => {
  let renderer: ReactTestRenderer;
  await act(async () => { renderer = create(<Probe />); });
  expect(seen).toBe(false);
  await act(async () => { renderer.unmount(); });
});

it('a read during the sign-out does not bring the previous acknowledgement back', async () => {
  await acknowledgeLocationDisclosure();
  // The removal is slow; something asks in the meantime.
  const remove = jest.spyOn(AsyncStorage, 'removeItem');
  let finishRemoval!: () => void;
  remove.mockImplementationOnce(() => new Promise<void>((done) => { finishRemoval = done; }));

  const reset = resetLocationDisclosure();
  expect(await hasAcknowledgedLocationDisclosure()).toBe(false);
  finishRemoval();
  await reset;

  expect(await hasAcknowledgedLocationDisclosure()).toBe(false);
  remove.mockRestore();
});

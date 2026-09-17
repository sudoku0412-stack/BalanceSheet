import React from 'react';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import type { Receipt } from '../../types';

/** Climbs the rendered-instance parent chain from `node` until it finds
 *  one with a truthy `onPress` prop, then presses it. Used below instead
 *  of hardcoding a parent-depth number, which would silently start
 *  pressing the wrong element the next time this row's JSX nesting
 *  changes (exactly the kind of thing a restyle does). */
function pressNearestPressableAncestor(node: { parent: any; props?: Record<string, unknown> }) {
  let current: any = node;
  while (current && typeof current.props?.onPress !== 'function') {
    current = current.parent;
  }
  if (!current) throw new Error('No ancestor with an onPress handler was found.');
  fireEvent.press(current);
}

// Targeted tests for the new swipe-to-delete feature on the Expenses/
// History list (app/(tabs)/history.tsx): confirm the happy path, then
// try to break it — cancel, concurrent-delete guarding, the
// search-vs-full-list refresh branch, and what happens when the delete
// itself fails (no error handling exists in the source for that last
// one, and this suite pins down exactly what "no error handling" means
// in practice).

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

// Swipeable just needs to render its children plus give the row-delete
// action a way to be pressed — same stand-in already used for
// households.tsx's identical pattern in households.test.tsx. Tests
// never simulate an actual swipe gesture; the right action is always
// rendered so it can be pressed directly.
//
// `hitSlop` is captured (not just swallowed) so the regression test
// below can assert the row actually passes the edge-back-gesture fix
// through to the real Swipeable, rather than the prop silently getting
// lost if this mock changes.
const capturedSwipeableProps: any[] = [];
jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  const ReactActual = require('react');
  return {
    Swipeable: ReactActual.forwardRef(({ children, renderRightActions, ...rest }: any, ref: any) => {
      ReactActual.useImperativeHandle(ref, () => ({ close: jest.fn() }));
      capturedSwipeableProps.push(rest);
      return (
        <RN.View>
          {children}
          {renderRightActions ? renderRightActions() : null}
        </RN.View>
      );
    }),
  };
});

const mockDeleteReceipt = jest.fn();
jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(),
  searchReceipts: jest.fn(),
  deleteReceipt: (...args: unknown[]) => mockDeleteReceipt(...args),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

import HistoryScreen from '../../app/(tabs)/history';
import { getAllReceipts, searchReceipts } from '../../lib/database';

const mockGetAllReceipts = getAllReceipts as jest.Mock;
const mockSearchReceipts = searchReceipts as jest.Mock;

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    storeName: 'Store',
    date: new Date().toISOString().slice(0, 10),
    totalAmount: 10,
    category: 'Other',
    ...overrides,
  } as Receipt;
}

describe('HistoryScreen swipe-to-delete', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedSwipeableProps.length = 0;
    mockGetAllReceipts.mockResolvedValue([]);
    mockSearchReceipts.mockResolvedValue([]);
    mockDeleteReceipt.mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert');
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('swiping and confirming delete calls deleteReceipt with the row id, then refreshes the list', async () => {
    // Default 5000ms waitFor timeout is fine locally but occasionally
    // too tight on a loaded/shared CI runner — bump it rather than
    // fight runner-speed flakiness with a real app-behavior change.
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({ id: 'r1', storeName: 'Coffee Shop' }),
      makeReceipt({ id: 'r2', storeName: 'Grocery Store' }),
    ]);
    render(<HistoryScreen />);
    await waitFor(() => screen.getByText('Coffee Shop'));

    // Two rows are rendered, each with its own always-visible "Delete"
    // action text (the Swipeable mock never hides it) — target r1's.
    fireEvent.press(screen.getAllByText('Delete')[0]);

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Receipt',
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Delete' }),
      ]),
    );

    // After deleting, the list is refetched via getAllReceipts (no
    // active search) — return only the surviving receipt so the UI
    // change is observable.
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r2', storeName: 'Grocery Store' })]);

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')?.onPress?.();
      await Promise.resolve();
    });

    expect(mockDeleteReceipt).toHaveBeenCalledWith('r1');
    await waitFor(() => {
      expect(screen.queryByText('Coffee Shop')).toBeNull();
    });
    expect(screen.getByText('Grocery Store')).toBeTruthy();
  }, 15000);

  it('cancelling the confirm alert never calls deleteReceipt', async () => {
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r1', storeName: 'Coffee Shop' })]);
    render(<HistoryScreen />);
    await waitFor(() => screen.getByText('Coffee Shop'));

    fireEvent.press(screen.getByText('Delete'));
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    // Cancel has no onPress at all in the source — pressing it is a
    // pure dismiss. Confirm that's really the shape of the button
    // rather than assuming it, then confirm no delete happens.
    expect(buttons.find((b) => b.text === 'Cancel')?.onPress).toBeUndefined();

    expect(mockDeleteReceipt).not.toHaveBeenCalled();
    expect(screen.getByText('Coffee Shop')).toBeTruthy();
  });

  it('a second row\'s delete action is disabled while the first delete is still in flight', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({ id: 'r1', storeName: 'Coffee Shop' }),
      makeReceipt({ id: 'r2', storeName: 'Grocery Store' }),
    ]);
    let resolveDelete: () => void = () => {};
    mockDeleteReceipt.mockImplementation(
      () => new Promise<void>((resolve) => { resolveDelete = resolve; }),
    );
    render(<HistoryScreen />);
    await waitFor(() => screen.getByText('Coffee Shop'));

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.press(deleteButtons[0]);
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')?.onPress?.();
      await Promise.resolve();
    });

    // r1's delete is now in flight (deleteReceipt's promise hasn't
    // resolved). r1's own action swaps its "Delete" text for a spinner
    // (deletingId === r.id), so the only remaining "Delete" text is
    // r2's — pressing it must still be a no-op: the TouchableOpacity is
    // `disabled` globally whenever `deletingId` is set, not just for
    // the row actually being deleted.
    expect(mockDeleteReceipt).toHaveBeenCalledTimes(1);
    const remainingDeleteButtons = screen.getAllByText('Delete');
    expect(remainingDeleteButtons).toHaveLength(1);
    fireEvent.press(remainingDeleteButtons[0]);
    expect(mockDeleteReceipt).toHaveBeenCalledTimes(1);
    expect(mockDeleteReceipt).not.toHaveBeenCalledWith('r2');

    await act(async () => {
      resolveDelete();
      await Promise.resolve();
    });
  });

  it('deleting while a search filter is active refreshes via searchReceipts, not getAllReceipts', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({ id: 'r1', storeName: 'Coffee Shop' }),
      makeReceipt({ id: 'r2', storeName: 'Coffee House' }),
    ]);
    render(<HistoryScreen />);
    await waitFor(() => screen.getByText('Coffee Shop'));

    mockSearchReceipts.mockResolvedValue([
      makeReceipt({ id: 'r1', storeName: 'Coffee Shop' }),
      makeReceipt({ id: 'r2', storeName: 'Coffee House' }),
    ]);
    fireEvent.changeText(screen.getByPlaceholderText('Search merchant'), 'coffee');
    await waitFor(() => expect(mockSearchReceipts).toHaveBeenCalledWith('coffee'));

    mockGetAllReceipts.mockClear();
    // After the delete, only r2 should remain in the (still active)
    // search result set.
    mockSearchReceipts.mockResolvedValue([makeReceipt({ id: 'r2', storeName: 'Coffee House' })]);

    fireEvent.press(screen.getAllByText('Delete')[0]);
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockSearchReceipts).toHaveBeenCalledWith('coffee');
    });
    // The bug this guards against: refreshing via getAllReceipts
    // instead would silently drop the active search filter and show
    // the user's ENTIRE receipt list right after a delete.
    expect(mockGetAllReceipts).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText('Coffee Shop')).toBeNull();
    });
    expect(screen.getByText('Coffee House')).toBeTruthy();
  });

  /**
   * There is no try/catch around `deleteReceipt` itself in
   * performDeleteReceipt — only a `finally` that resets `deletingId`.
   * This pins down exactly what that gap means: a failed delete resets
   * the in-flight guard (so the UI isn't stuck) but the row is NEVER
   * refetched/restored, no error toast/alert is shown, and the
   * rejection is left unhandled. From the user's point of view the
   * swipe just silently does nothing after the confirm tap. This is a
   * real gap worth fixing, not something the test suite should paper
   * over by asserting nicer behavior than the code has.
   */
  it('a rejected deleteReceipt clears the in-flight guard but shows no error and never refreshes the list', async () => {
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r1', storeName: 'Coffee Shop' })]);
    mockDeleteReceipt.mockRejectedValue(new Error('disk full'));
    render(<HistoryScreen />);
    await waitFor(() => screen.getByText('Coffee Shop'));

    fireEvent.press(screen.getByText('Delete'));
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];

    let caught: unknown;
    await act(async () => {
      try {
        await Promise.resolve(buttons.find((b) => b.text === 'Delete')?.onPress?.());
      } catch (e) {
        caught = e;
      }
      await Promise.resolve();
    });

    // The row is still in the list — deleteReceipt failed, and
    // refreshAfterDelete() was never reached because it's called
    // AFTER the (rejected) `await deleteReceipt(id)`, not in the
    // `finally`.
    expect(screen.getByText('Coffee Shop')).toBeTruthy();
    // getAllReceipts was called once on mount and never again — no
    // refresh attempt happened after the failed delete.
    expect(mockGetAllReceipts).toHaveBeenCalledTimes(1);

    // The in-flight guard IS still cleared (via `finally`), so a
    // second delete attempt on the same row is possible rather than
    // the UI getting stuck forever in a "deleting…" spinner state.
    mockDeleteReceipt.mockResolvedValue(undefined);
    mockGetAllReceipts.mockResolvedValue([]);
    fireEvent.press(screen.getByText('Delete'));
    const secondButtons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => {
      secondButtons.find((b) => b.text === 'Delete')?.onPress?.();
      await Promise.resolve();
    });
    expect(mockDeleteReceipt).toHaveBeenCalledTimes(2);
  });

  /**
   * The card restyle (rounded corners, shadows, new avatar chips) wraps
   * the row's content in an extra layer and reshuffles nested Views, but
   * it must not shrink the swipe-revealed delete action's touch target.
   * 84 is the deleteAction style's fixed `width` in history.tsx — this
   * pins that the restyle didn't quietly narrow it down along the way.
   */
  it('the swipe-revealed delete action keeps its 84px hit-area width after the restyle', async () => {
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r1', storeName: 'Coffee Shop' })]);
    render(<HistoryScreen />);
    await waitFor(() => screen.getByText('Coffee Shop'));

    // Climb from the "Delete" text up to its nearest ancestor whose
    // flattened style actually carries a `width` — rather than assuming
    // a fixed number of parent hops through the icon/text Fragment,
    // which would silently break the next time this action's JSX
    // nesting changes.
    let current: any = screen.getByText('Delete');
    let flattened: Record<string, unknown> = {};
    while (current) {
      flattened = StyleSheet.flatten(current.props?.style) ?? {};
      if (flattened.width !== undefined) break;
      current = current.parent;
    }
    expect(flattened.width).toBe(84);
  });

  /**
   * Wrapping each row in a Swipeable for the new delete gesture must not
   * break the pre-existing tap-to-edit interaction on the row body
   * itself — a real risk any time a gesture wrapper is added around an
   * already-tappable row.
   */
  it('tapping the row body still navigates to /edit/:id despite the new Swipeable wrapper', async () => {
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r1', storeName: 'Coffee Shop' })]);
    render(<HistoryScreen />);
    await waitFor(() => screen.getByText('Coffee Shop'));

    pressNearestPressableAncestor(screen.getByText('Coffee Shop'));

    expect(mockPush).toHaveBeenCalledWith('/edit/r1');
  });

  /**
   * Regression guard for the Android system back-gesture fix (commit
   * 809b04d): this row's Swipeable spans the full screen width with no
   * gap at the left edge, so without a negative left hitSlop its own
   * pan handler claims touches starting at x=0 — the same strip the OS
   * reads an edge back-swipe from (react-native-gesture-handler#890).
   * If this prop is ever dropped during a future edit, the system
   * back-swipe silently breaks again on Android with no visible test
   * failure elsewhere, so it's pinned down explicitly here.
   */
  it('the row Swipeable carries a negative left hitSlop so it does not swallow the system back-swipe', async () => {
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r1', storeName: 'Coffee Shop' })]);
    render(<HistoryScreen />);
    await waitFor(() => screen.getByText('Coffee Shop'));

    expect(capturedSwipeableProps.length).toBeGreaterThan(0);
    for (const props of capturedSwipeableProps) {
      expect(props.hitSlop).toEqual(expect.objectContaining({ left: expect.any(Number) }));
      expect(props.hitSlop.left).toBeLessThan(0);
    }
  });
});

import { notifyLocalDataChanged, onLocalDataChanged } from '../lib/dataSync';

describe('dataSync', () => {
  it('calls every registered listener when notified', () => {
    const a = jest.fn();
    const b = jest.fn();
    onLocalDataChanged(a);
    onLocalDataChanged(b);

    notifyLocalDataChanged();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('stops calling a listener once its unsubscribe function runs', () => {
    const listener = jest.fn();
    const unsubscribe = onLocalDataChanged(listener);

    unsubscribe();
    notifyLocalDataChanged();

    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener registered twice only fires once per notify (Set semantics)', () => {
    const listener = jest.fn();
    onLocalDataChanged(listener);
    onLocalDataChanged(listener);

    notifyLocalDataChanged();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

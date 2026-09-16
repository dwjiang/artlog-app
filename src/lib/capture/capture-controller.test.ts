import { CaptureController } from './capture-controller';

function failed() {
  const controller = new CaptureController();
  const attempt = controller.begin('camera')!;
  controller.fail(attempt, 'Dodge the glare');
  controller.finish(attempt);
  return controller;
}

it('starts one capture at a time and blocks overlapping imports', () => {
  const controller = new CaptureController();
  expect(controller.begin('camera')).toMatchObject({ source: 'camera', valid: true });
  expect(controller.begin('camera')).toBeUndefined();
  expect(controller.begin('library')).toBeUndefined();
  expect(controller.getSnapshot().phase).toBe('capturing');
});

it('keeps the failure message until the next shutter press replaces it', () => {
  const controller = failed();
  expect(controller.getSnapshot()).toMatchObject({ phase: 'retry', message: 'Dodge the glare', occupied: false });
  expect(controller.begin('camera')).toBeDefined();
  expect(controller.getSnapshot()).toMatchObject({ phase: 'capturing', message: undefined });
});

it('ignores the shutter while unfocused or backgrounded', () => {
  const controller = new CaptureController();
  controller.setActive(false);
  expect(controller.begin('camera')).toBeUndefined();
  controller.setActive(true);
  expect(controller.begin('camera')).toBeDefined();
});

it('cancels old ownership but retains the capture lock until pending work finishes', () => {
  const controller = new CaptureController();
  const attempt = controller.begin('camera')!;
  controller.reset();
  expect(attempt.valid).toBe(false);
  expect(controller.begin('library')).toBeUndefined();
  expect(controller.result(attempt)).toBe(false);
  controller.finish(attempt);
  expect(controller.begin('camera')).toBeDefined();
});

it('blocks scanning on results and starts a fresh session on return', () => {
  const controller = new CaptureController();
  const attempt = controller.begin('camera')!;
  controller.processing(attempt);
  controller.revealing(attempt);
  controller.finish(attempt);
  expect(controller.begin('library')).toBeUndefined();
  expect(controller.result(attempt)).toBe(true);
  expect(controller.result(attempt)).toBe(false);
  expect(controller.begin('camera')).toBeUndefined();
  controller.reset();
  expect(controller.begin('camera')).toBeDefined();
});

it('lets a failed import continue with another photo or the camera', () => {
  const controller = new CaptureController();
  const attempt = controller.begin('library')!;
  controller.fail(attempt, 'Fit all corners');
  controller.finish(attempt);
  expect(controller.getSnapshot()).toMatchObject({ phase: 'retry', source: 'library' });
  expect(controller.begin('library')).toBeDefined();
});

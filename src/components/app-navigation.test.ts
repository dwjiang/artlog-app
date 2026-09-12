import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import { getMockConfig } from 'expo-router/testing-library';

const config = getMockConfig('src/app');

// Use the real route files and URL parser without mounting native navigators.
function getRootState(path: string) {
  return getStateFromPath(path, config)?.routes[0].state;
}

function getTabsState(path: string) {
  return getRootState(path)?.routes.find((route) => route.name === '(tabs)')?.state;
}

describe('App navigation', () => {
  it('opens Scan at the root URL', () => {
    const tabs = getTabsState('/');
    expect(tabs?.routes[tabs.index ?? 0]).toMatchObject({
      name: '(scan)',
      state: { routes: [{ name: 'index' }] },
    });
  });

  it.each(['collection', 'settings'])('opens the %s tab at its own URL', (tab) => {
    const tabs = getTabsState(`/${tab}`);
    expect(tabs?.routes[tabs.index ?? 0]).toMatchObject({
      name: `(${tab})`,
      state: { routes: [{ name: tab }] },
    });
  });

  it.each(['venue-picker', 'queue'])('keeps the tabs underneath a directly opened %s sheet', (sheet) => {
    const root = getRootState(`/${sheet}`);
    expect(root?.routes.map((route) => route.name)).toEqual(['(tabs)', sheet]);
    expect(root?.index).toBe(1);
  });

  it('keeps the Collection list behind a directly opened saved work', () => {
    const collection = getTabsState('/demo')?.routes.find(
      (route) => route.name === '(collection)'
    )?.state;

    expect(collection?.routes.map((route) => route.name)).toEqual(['collection', '[savedId]']);
    expect(collection?.index).toBe(1);
    expect(collection?.routes[1].params).toMatchObject({ savedId: 'demo' });
  });

  it.each(['result', 'label'])('keeps Scan behind a directly opened %s', (screen) => {
    const scan = getTabsState(`/${screen}/demo`)?.routes.find(
      (route) => route.name === '(scan)'
    )?.state;

    expect(scan?.routes.map((route) => route.name)).toEqual(['index', `${screen}/[scanId]`]);
    expect(scan?.index).toBe(1);
    expect(scan?.routes[1].params).toMatchObject({ scanId: 'demo' });
  });
});

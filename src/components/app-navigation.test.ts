import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import { getMockConfig } from 'expo-router/testing-library';

jest.mock('./visits/visit-share-flow', () => ({ VisitShareLayout: () => null }));

const config = getMockConfig('src/app');

// Use the real route files and URL parser without mounting native navigators.
function getRootState(path: string) {
  return getStateFromPath(path, config)?.routes[0].state;
}

function getTabsState(path: string) {
  return getRootState(path)?.routes.find((route) => route.name === '(tabs)')?.state;
}

describe('App navigation', () => {
  it('opens Home at the root URL', () => {
    const tabs = getTabsState('/');
    expect(tabs?.routes[tabs.index ?? 0]).toMatchObject({
      name: '(home)',
      state: { routes: [{ name: 'index' }] },
    });
  });

  it.each(['scan', 'collection'])('opens the %s tab at its own URL', (tab) => {
    const tabs = getTabsState(`/${tab}`);
    expect(tabs?.routes[tabs.index ?? 0]).toMatchObject({
      name: `(${tab})`,
      state: { routes: [{ name: tab }] },
    });
  });

  it.each(['settings', 'people', 'create-profile', 'artwork', 'venue-picker', 'queue', 'visit-create', 'visit-reflection', 'visit-globe'])('keeps the tabs underneath a directly opened %s', (sheet) => {
    const root = getRootState(`/${sheet}`);
    expect(root?.routes.map((route) => route.name)).toEqual(['(tabs)', sheet]);
    expect(root?.index).toBe(1);
  });

  it('opens sharing as a sheet with its nested preview route', () => {
    const root = getRootState('/visit-share/demo/preview');
    expect(root?.routes.map((route) => route.name)).toEqual(['(tabs)', 'visit-share/[visitId]']);
    expect(root?.routes[1]).toMatchObject({
      params: { visitId: 'demo' },
      state: { routes: [{ name: 'preview' }] },
    });
  });

  it('keeps Collection behind a directly opened journal visit', () => {
    const collection = getTabsState('/journal/demo')?.routes.find(
      (route) => route.name === '(collection)'
    )?.state;
    expect(collection?.routes.map((route) => route.name)).toEqual(['collection', 'journal/[visitId]']);
    expect(collection?.routes[1].params).toMatchObject({ visitId: 'demo' });
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

    expect(scan?.routes.map((route) => route.name)).toEqual(['scan', `${screen}/[scanId]`]);
    expect(scan?.index).toBe(1);
    expect(scan?.routes[1].params).toMatchObject({ scanId: 'demo' });
  });

  it.each(['visit/post-id', 'profile/profile-id'])('opens %s above the tabs', (path) => {
    const root = getRootState(`/${path}`);
    expect(root?.routes[0].name).toBe('(tabs)');
    expect(root?.routes[1].name).toBe(path.startsWith('visit') ? 'visit/[postId]' : 'profile/[profileId]');
  });
});

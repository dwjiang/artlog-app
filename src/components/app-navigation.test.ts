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

  it.each(['settings', 'people', 'create-profile', 'artwork', 'venue-picker', 'queue', 'visit-create', 'visit-globe'])('keeps the tabs underneath a directly opened %s', (sheet) => {
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

  // Artwork and visit details open above whichever tab is active, so a scan never switches to Collection.
  it.each([['journal/demo', 'journal/[visitId]', { visitId: 'demo' }], ['saved/demo', 'saved/[savedId]', { savedId: 'demo' }]])(
    'opens %s above the tabs instead of inside Collection', (path, name, params) => {
      const root = getRootState(`/${path}`);
      expect(root?.routes.map((route) => route.name)).toEqual(['(tabs)', name]);
      expect(root?.index).toBe(1);
      expect(root?.routes[1].params).toMatchObject(params);
      expect(getTabsState(`/${path}`)?.routes.find((route) => route.name === '(collection)')?.state).toBeUndefined();
    });

  it.each(['result', 'label'])('opens %s above the tabs with the capture identifier', (screen) => {
    const root = getRootState(`/${screen}/demo`);
    expect(root?.routes.map((route) => route.name)).toEqual(['(tabs)', `${screen}/[scanId]`]);
    expect(root?.index).toBe(1);
    expect(root?.routes[1].params).toMatchObject({ scanId: 'demo' });
  });

  it('opens the artwork archive above the collection tab', () => {
    const root = getRootState('/all-artworks');
    expect(root?.routes.map((route) => route.name)).toEqual(['(tabs)', 'all-artworks']);
  });

  it.each(['visit/post-id', 'profile/profile-id'])('opens %s above the tabs', (path) => {
    const root = getRootState(`/${path}`);
    expect(root?.routes[0].name).toBe('(tabs)');
    expect(root?.routes[1].name).toBe(path.startsWith('visit') ? 'visit/[postId]' : 'profile/[profileId]');
  });
});

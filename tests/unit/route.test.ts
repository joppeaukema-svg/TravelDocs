import { describe, expect, it } from 'vitest';
import { routeOrder, splitByRoute } from '../../src/trip/route';
import { stay } from './rules/helpers';

// Made-up dates only (see the privacy test).
const stays = [
  stay({ country: 'JP', from: '2031-03-01', to: '2031-03-10' }),
  stay({ country: 'VN', from: '2031-03-10', to: '2031-03-20' }),
  stay({ country: 'LA', from: '2031-03-20', to: '2031-03-30' }),
  stay({ country: 'PH', from: '2031-03-30', to: '2031-04-09' }),
];

describe('route order', () => {
  it('puts the country you are in first, then the ones to come, then the ones you have been to', () => {
    const r = routeOrder(stays, '2031-03-25', 'LA');
    expect(r.order).toEqual(['LA', 'PH', 'JP', 'VN']);
    expect(['LA', 'PH', 'JP', 'VN', 'TH'].map(r.status)).toEqual(['here', 'upcoming', 'past', 'past', undefined]);
  });

  it('on a travel day the country you left is past once you are in the next one', () => {
    expect(routeOrder(stays, '2031-03-10', 'VN').order).toEqual(['VN', 'LA', 'PH', 'JP']);
    // In the morning you are still in Japan; Vietnam starts today.
    expect(routeOrder(stays, '2031-03-10', 'JP').order).toEqual(['JP', 'VN', 'LA', 'PH']);
  });

  it('a country you will be back in is still to come; before the trip all are, in trip order', () => {
    const back = [...stays, stay({ country: 'JP', from: '2031-04-09', to: '2031-04-12' })];
    expect(routeOrder(back, '2031-03-25', 'LA').status('JP')).toBe('upcoming');
    expect(routeOrder(back, '2031-03-25', 'LA').order).toEqual(['LA', 'PH', 'JP', 'VN']);
    expect(routeOrder(stays, '2031-01-01', null).order).toEqual(['JP', 'VN', 'LA', 'PH']);
  });

  it('splits a list: ahead (off-route ones after the route, as they were) and past, in route order', () => {
    const r = routeOrder(stays, '2031-03-25', 'LA');
    const langs = [
      { id: 'zh', countries: ['CN'] },
      { id: 'ja', countries: ['JP'] },
      { id: 'vi', countries: ['VN'] },
      { id: 'th', countries: ['TH'] },
      { id: 'lo', countries: ['LA'] },
      { id: 'fil', countries: ['PH'] },
      { id: 'none', countries: [] },
    ];
    const { ahead, past } = splitByRoute(langs, (l) => l.countries, r);
    expect(ahead.map((l) => l.id)).toEqual(['lo', 'fil', 'zh', 'th', 'none']);
    expect(past.map((l) => l.id)).toEqual(['ja', 'vi']);
    // Without a trip nothing is past, and the order stays as it was.
    expect(splitByRoute(langs, (l) => l.countries, routeOrder([], '2031-03-25', null)).ahead).toEqual(langs);
  });
});

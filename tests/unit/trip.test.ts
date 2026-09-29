import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportTripFile, parseTripFile, TripFileError } from '../../src/trip/io';
import { durationMinutes, formatLocal, utcOffset } from '../../src/trip/time';

const demo = () => JSON.parse(readFileSync('demo/trip.demo.json', 'utf8')) as Record<string, unknown>;

describe('trip file import', () => {
  it('imports the demo trip completely', () => {
    const { data, rejected } = parseTripFile(demo());
    expect(rejected).toEqual([]);
    expect(data.stays).toHaveLength(7);
    expect(data.bookings.length).toBeGreaterThan(30);
    expect(data.days.length).toBe(90);
    expect(data.meta.demo).toBe(true);
  });

  it('lists what it could not import, and keeps the rest', () => {
    const file = demo();
    const stays = file.stays as Record<string, unknown>[];
    const bookings = file.bookings as Record<string, unknown>[];
    stays.push({ ...stays[0], id: 'bad-dates', from: '2030-01-10', to: '2030-01-01' });
    stays.push({ ...stays[0] }); // duplicate id
    bookings.push({ id: 'bad-zone', type: 'flight', status: 'booked', depart: { date: '2030-01-01', time: '10:00', tz: 'Mars/Olympus' } });
    bookings.push({ id: 'bad-type', type: 'rocket', status: 'booked' });
    const { data, rejected } = parseTripFile(file);
    expect(rejected.map((r) => r.where)).toEqual(['Stay bad-dates', `Stay ${String(stays[0]!.id)}`, 'Booking bad-zone', 'Booking bad-type']);
    expect(rejected[0]!.reason).toMatch(/before "from"/);
    expect(rejected[1]!.reason).toMatch(/duplicate/);
    expect(rejected[2]!.reason).toMatch(/time zone/);
    expect(data.stays).toHaveLength(7);
  });

  it('refuses files in another format', () => {
    expect(() => parseTripFile({ format: 'something-else/1' })).toThrow(TripFileError);
    expect(() => parseTripFile({ format: 'travel-companion-trip/1' })).toThrow(/incomplete/);
  });

  it('exports the same format back', () => {
    const { data } = parseTripFile(demo());
    const again = parseTripFile(JSON.parse(JSON.stringify(exportTripFile(data))));
    expect(again.rejected).toEqual([]);
    expect(again.data).toEqual(data);
  });
});

describe('time zones', () => {
  const depart = { date: '2027-03-09', time: '10:05', tz: 'Asia/Tokyo' };
  const arrive = { date: '2027-03-09', time: '13:20', tz: 'Asia/Ho_Chi_Minh' };

  it('a flight crossing time zones shows local times at both ends and the real duration', () => {
    expect(formatLocal(depart)).toBe('Tue 9 Mar, 10:05');
    expect(formatLocal(arrive)).toBe('Tue 9 Mar, 13:20');
    expect(utcOffset(depart)).toBe('UTC+9');
    expect(utcOffset(arrive)).toBe('UTC+7');
    expect(durationMinutes(depart, arrive)).toBe(315);
  });

  it('handles the overnight flight out of Amsterdam across the clock change', () => {
    const ams = { date: '2027-10-30', time: '20:10', tz: 'Europe/Amsterdam' };
    const pvg = { date: '2027-10-31', time: '13:40', tz: 'Asia/Shanghai' };
    expect(utcOffset(ams)).toBe('UTC+2'); // CEST until 31 Oct 2027
    expect(utcOffset({ ...ams, date: '2027-11-01' })).toBe('UTC+1');
    expect(durationMinutes(ams, pvg)).toBe(11 * 60 + 30);
    expect(durationMinutes(ams, { ...pvg, time: null })).toBeNull();
  });
});

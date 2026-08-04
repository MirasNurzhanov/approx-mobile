// The three shapes `for-point` can answer with, and how the client tells them
// apart.
//
// This matters more than it looks. A resolved answer carries the region's own
// fields at the top level — the shape the endpoint has always had, which an
// older build still reads `id` off — while the two "we will not guess" answers
// carry `candidates` instead. Confusing them would either drop a perfectly good
// region on the floor or hand a low-confidence guess to the zone as though the
// server had been sure.

import { regionForPoint, type RegionSummary } from '../zoneArea';
import { api } from '../api';

jest.mock('../api', () => ({ api: { get: jest.fn(), patch: jest.fn() } }));

const mockGet = api.get as jest.Mock;

const REGION: RegionSummary = {
  id: 7,
  name: 'Msasani',
  display_name: 'Msasani, Dar es Salaam',
  country_code: 'tz',
  kind: 'district',
  admin_level: 7,
  min_lat: 0,
  min_lon: 0,
  max_lat: 1,
  max_lon: 1,
  centroid_lat: 0.5,
  centroid_lon: 0.5,
  point_count: 5,
};

/** An axios-shaped 404, which is what a miss arrives as. */
function notFound(data: unknown) {
  return Object.assign(new Error('Not found'), { response: { status: 404, data } });
}

beforeEach(() => mockGet.mockReset());

describe('regionForPoint', () => {
  it('reads a resolved region off the top level', () => {
    mockGet.mockResolvedValue({ data: { ...REGION, outcome: 'resolved', stage: 'cache' } });
    return regionForPoint(-6.75, 39.27, 'district').then((lookup) => {
      expect(lookup.outcome).toBe('resolved');
      expect(lookup.region?.id).toBe(7);
      expect(lookup.candidates).toEqual([]);
    });
  });

  it('carries the fallback outcome through rather than flattening it', () => {
    // The screen does not currently distinguish the two, but the coverage
    // reporting does — a district that only ever resolves via the fallback is
    // a country whose address hierarchy needs looking at.
    mockGet.mockResolvedValue({
      data: { ...REGION, outcome: 'resolved_fallback', stage: 'boundary_relations' },
    });
    return regionForPoint(-6.75, 39.27, 'district').then((lookup) => {
      expect(lookup.outcome).toBe('resolved_fallback');
      expect(lookup.region?.id).toBe(7);
    });
  });

  it('surfaces ambiguity as ranked choices and no region', () => {
    mockGet.mockResolvedValue({
      data: {
        outcome: 'ambiguous',
        detail: 'More than one place fits.',
        city_name: 'Dar es Salaam',
        candidates: [
          { region: REGION, score: 70, reasons: ['sits inside Dar es Salaam'], stage: 'cache' },
          { region: { ...REGION, id: 8, name: 'Kinondoni' }, score: 66, reasons: [], stage: 'cache' },
        ],
        can_trace: true,
      },
    });
    return regionForPoint(-6.75, 39.27, 'district').then((lookup) => {
      expect(lookup.outcome).toBe('ambiguous');
      expect(lookup.region).toBeNull();
      expect(lookup.candidates).toHaveLength(2);
      expect(lookup.candidates[0].reasons).toContain('sits inside Dar es Salaam');
      expect(lookup.cityName).toBe('Dar es Salaam');
    });
  });

  it('never treats a low-confidence answer as a region', () => {
    mockGet.mockResolvedValue({
      data: {
        outcome: 'rejected',
        detail: 'Nothing here looks reliably like a district.',
        city_name: 'Portland',
        candidates: [{ region: REGION, score: 30, reasons: [], stage: 'cache' }],
      },
    });
    return regionForPoint(45.5, -122.6, 'district').then((lookup) => {
      expect(lookup.outcome).toBe('rejected');
      expect(lookup.region).toBeNull();
      expect(lookup.candidates).toHaveLength(1);
    });
  });

  it('reports an unmapped area with the city it searched', () => {
    mockGet.mockRejectedValue(
      notFound({
        outcome: 'unmapped',
        detail: 'No mapped district inside Portland.',
        city_name: 'Portland',
      }),
    );
    return regionForPoint(45.5, -122.6, 'district').then((lookup) => {
      expect(lookup.outcome).toBe('unmapped');
      expect(lookup.region).toBeNull();
      expect(lookup.candidates).toEqual([]);
      expect(lookup.cityName).toBe('Portland');
    });
  });

  it('defaults a 404 with no outcome to unmapped', () => {
    // An older server, or a proxy's own 404. Guessing "unmapped" is right:
    // it is the outcome that offers the user the most useful next step.
    mockGet.mockRejectedValue(notFound({ detail: 'Not found.' }));
    return regionForPoint(0, 0).then((lookup) => {
      expect(lookup.outcome).toBe('unmapped');
    });
  });

  it('lets a real failure through rather than reporting it as empty', () => {
    // A 503 is not "there is no district here". Swallowing it would tell
    // somebody their area is unmapped when the lookup service was merely busy.
    mockGet.mockRejectedValue(
      Object.assign(new Error('busy'), { response: { status: 503, data: {} } }),
    );
    return expect(regionForPoint(0, 0)).rejects.toThrow('busy');
  });

  it('asks for the level it was given', () => {
    mockGet.mockResolvedValue({ data: REGION });
    return regionForPoint(-6.75, 39.27, 'district').then(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/api/regions/for-point/',
        { params: { lat: -6.75, lon: 39.27, level: 'district' } },
      );
    });
  });
});

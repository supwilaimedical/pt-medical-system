/**
 * Places API wrapper — Phase 3
 *
 * Uses Google Places API (New) via REST — no SDK dependency.
 * Requires MapConfig.apiKey to be configured.
 *
 * Main use case: find nearest hospitals from a given GPS position.
 *
 * Docs:
 *   https://developers.google.com/maps/documentation/places/web-service/nearby-search
 *
 * Usage:
 *   var hospitals = await PlacesAPI.searchNearbyHospitals(lat, lng, 5000);
 *   // hospitals = [{ name, lat, lng, address, distanceM, placeId, rating, phone }, ...]
 */
(function(global) {
  'use strict';

  var PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
  var PLACES_TEXT_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
  var PLACE_DETAILS_ENDPOINT = 'https://places.googleapis.com/v1/places/';

  var FIELD_MASK = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.rating',
    'places.userRatingCount',
    'places.nationalPhoneNumber',
    'places.internationalPhoneNumber',
    'places.primaryType',
    'places.types',
    'places.businessStatus',
    'places.googleMapsUri'
  ].join(',');

  function mapPlace(p, originLat, originLng) {
    var loc = p.location || {};
    var placeLat = loc.latitude, placeLng = loc.longitude;
    return {
      placeId: p.id,
      name: (p.displayName && p.displayName.text) || '',
      address: p.formattedAddress || '',
      lat: placeLat,
      lng: placeLng,
      rating: p.rating || null,
      ratingCount: p.userRatingCount || 0,
      phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
      type: p.primaryType || '',
      types: p.types || [],
      status: p.businessStatus || '',
      googleMapsUri: p.googleMapsUri || '',
      distanceM: (placeLat != null && placeLng != null && originLat != null && originLng != null)
        ? Math.round(haversineDistance(originLat, originLng, placeLat, placeLng))
        : null
    };
  }

  /** Haversine distance in meters. */
  function haversineDistance(lat1, lng1, lat2, lng2) {
    var R = 6371000; // Earth radius in meters
    var toRad = function(d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  var PlacesAPI = {
    /**
     * Search nearby places by type.
     * @param {Object} opts
     * @param {number} opts.lat
     * @param {number} opts.lng
     * @param {number} opts.radius in meters (max 50000)
     * @param {string[]} opts.types Google place types (e.g. ['hospital'])
     * @param {number} [opts.maxResults=20] 1-20
     * @param {string} [opts.languageCode='th']
     * @param {string} [opts.rankPreference='DISTANCE'] DISTANCE|POPULARITY
     * @returns {Promise<Array>}
     */
    searchNearby: async function(opts) {
      opts = opts || {};
      if (!window.MapConfig) throw new Error('MapConfig not loaded');
      var apiKey = MapConfig.getConfig().apiKey;
      if (!apiKey) throw new Error('No Google Maps API key configured');

      var body = {
        maxResultCount: Math.min(opts.maxResults || 20, 20),
        locationRestriction: {
          circle: {
            center: { latitude: opts.lat, longitude: opts.lng },
            radius: Math.min(opts.radius || 5000, 50000)
          }
        },
        languageCode: opts.languageCode || 'th',
        rankPreference: opts.rankPreference || 'DISTANCE'
      };
      // Prefer primaryTypes (strict match on place's PRIMARY type)
      // over types (matches ANY tagged type, may include bycatch).
      if (opts.primaryTypes && opts.primaryTypes.length) {
        body.includedPrimaryTypes = opts.primaryTypes;
      } else {
        body.includedTypes = opts.types || ['hospital'];
      }

      var res = await fetch(PLACES_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        var errText = await res.text().catch(function(){ return ''; });
        throw new Error('Places API error (' + res.status + '): ' + errText);
      }

      var json = await res.json();
      return (json.places || []).map(function(p) { return mapPlace(p, opts.lat, opts.lng); });
    },

    /**
     * Text search for places near a location.
     * @param {Object} opts
     * @param {string} opts.query Free-text query
     * @param {number} opts.lat
     * @param {number} opts.lng
     * @param {number} [opts.radius=5000] meters (bias, not hard limit)
     * @param {number} [opts.maxResults=20]
     * @param {string} [opts.languageCode='th']
     */
    searchText: async function(opts) {
      opts = opts || {};
      if (!opts.query) throw new Error('query required');
      if (!window.MapConfig) throw new Error('MapConfig not loaded');
      var apiKey = MapConfig.getConfig().apiKey;
      if (!apiKey) throw new Error('No Google Maps API key configured');

      var body = {
        textQuery: opts.query,
        maxResultCount: Math.min(opts.maxResults || 20, 20),
        languageCode: opts.languageCode || 'th'
      };
      if (opts.lat != null && opts.lng != null) {
        body.locationBias = {
          circle: {
            center: { latitude: opts.lat, longitude: opts.lng },
            radius: Math.min(opts.radius || 5000, 50000)
          }
        };
      }

      var res = await fetch(PLACES_TEXT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        var errText = await res.text().catch(function(){ return ''; });
        throw new Error('Places API error (' + res.status + '): ' + errText);
      }

      var json = await res.json();
      var places = (json.places || []).map(function(p) { return mapPlace(p, opts.lat, opts.lng); });
      // Sort by distance if origin provided
      if (opts.lat != null && opts.lng != null) {
        places.sort(function(a,b){ return (a.distanceM||Infinity) - (b.distanceM||Infinity); });
      }
      return places;
    },

    /**
     * Convenience: search nearby hospitals.
     */
    searchNearbyHospitals: function(lat, lng, radius) {
      return this.searchNearby({
        lat: lat, lng: lng,
        radius: radius || 5000,
        types: ['hospital']
      });
    },

    /**
     * Hospital search with WIDE recall.
     * Single nearbySearch is hard-capped at 20 results and ~70-80% of those are
     * noise (Google's Thai data tags clinics/pharmacies/lodging as hospital).
     * After filtering, only 4-6 real hospitals remain even at 25 km radius.
     *
     * Strategy: run TWO parallel calls and merge:
     *   1) nearbySearch(primaryTypes=['hospital']) — anchored to type
     *   2) searchText(query='โรงพยาบาล')          — anchored to Thai name
     * Dedupe by placeId, filter noise, drop entries outside radius (text
     * search uses locationBIAS, not RESTRICT), sort by distance.
     *
     * Typical result: 15-30 hospitals at 25 km radius vs ~5 from single call.
     *
     * @param {number} lat
     * @param {number} lng
     * @param {number} [radius=5000] meters
     * @returns {Promise<Array>}
     */
    searchHospitalsCombined: async function(lat, lng, radius) {
      var self = this;
      radius = radius || 5000;

      var nearbyP = self.searchNearby({
        lat: lat, lng: lng, radius: radius,
        primaryTypes: ['hospital'], maxResults: 20
      }).catch(function(e){ console.warn('hospital nearby failed:', e); return []; });

      var textP = self.searchText({
        query: 'โรงพยาบาล',
        lat: lat, lng: lng, radius: radius, maxResults: 20
      }).catch(function(e){ console.warn('hospital text failed:', e); return []; });

      var batches = await Promise.all([nearbyP, textP]);
      // Merge + dedupe by placeId (or name+coords fallback)
      var seen = {};
      var combined = [];
      batches.forEach(function(list) {
        (list || []).forEach(function(p) {
          var key = p.placeId || ((p.name || '') + '|' + (p.lat || '') + '|' + (p.lng || ''));
          if (!seen[key]) { seen[key] = 1; combined.push(p); }
        });
      });
      // Apply hospital filter (whitelist + reject prefixes + secondary-type blacklist)
      combined = self.filterNoise(combined, 'hospital');
      // Text search uses locationBIAS, so results can fall outside radius
      combined = combined.filter(function(p) {
        return p.distanceM == null || p.distanceM <= radius;
      });
      // Sort by distance
      combined.sort(function(a, b) {
        return (a.distanceM == null ? Infinity : a.distanceM) -
               (b.distanceM == null ? Infinity : b.distanceM);
      });
      return combined;
    },

    /**
     * Convenience: search nearby gas stations.
     */
    searchNearbyGasStations: function(lat, lng, radius) {
      return this.searchNearby({
        lat: lat, lng: lng,
        radius: radius || 5000,
        types: ['gas_station']
      });
    },

    /**
     * Filter noise from Places API results.
     * Google's Thai data is permissive — primaryType=hospital matches lodging,
     * pet clinics, opticians, parking lots, hospital sub-departments, and
     * unrelated places that happen to be tagged hospital.
     *
     * Strategy:
     *  • Global blacklist on secondary types (lodging, salon, vet, parking, etc.)
     *  • UI-specific type blacklist (clinic excludes hospital; hospital excludes doctor/dentist)
     *  • Generic name blacklist (hotel/resort/spa/vet/eyewear)
     *  • For uiType='hospital': WHITELIST — name MUST contain hospital keyword
     *    (โรงพยาบาล | รพ. | ร.พ. | hospital | ศูนย์การแพทย์ | medical center),
     *    AND reject sub-units/parking by name prefix.
     *
     * @param {Array} places   Output of searchNearby / searchText
     * @param {string} uiType  UI category: hospital | clinic | pharmacy | gas_station | police | fire_station
     * @returns {Array} filtered
     */
    filterNoise: function(places, uiType) {
      if (!places || !places.length) return places;

      var globalBadTypes = {
        'lodging':1,'hotel':1,'motel':1,'resort_hotel':1,'hostel':1,'bed_and_breakfast':1,
        'guest_house':1,'inn':1,'rv_park':1,'campground':1,'apartment_complex':1,
        'veterinary_care':1,'pet_store':1,'animal_hospital':1,
        'beauty_salon':1,'hair_care':1,'spa':1,'nail_salon':1,
        'optician':1,'eyewear_store':1,
        'massage':1,
        'parking':1,'parking_lot':1
      };
      var uiBadTypes = {
        hospital:    { 'doctor':1, 'dentist':1, 'dental_clinic':1, 'physiotherapist':1, 'chiropractor':1 },
        clinic:      { 'hospital':1 },
        pharmacy:    {},
        gas_station: {},
        police:      {},
        fire_station:{}
      };
      var uiBad = uiBadTypes[uiType] || {};
      var badNameRe = /ห้องพัก|หอพัก|รีสอร์ท|รีสอร์ต|โรงแรม|hotel|hostel|resort|apartment|อพาร์ท|คอนโด|condo|B&B|guest.?house|pet|สัตว์|สัตวแพทย์|vet|นวด|massage|salon|สปา|spa|แว่น|optic|eyewear|พระเครื่อง/i;
      // Hospital whitelist — must contain ONE of these keywords
      var hospitalNameRequiredRe = /โรงพยาบาล|รพ\.|ร\.พ\.|hospital|medical\s*cent(re|er)|ศูนย์การแพทย์/i;
      // Hospital reject prefixes — sub-units, departments, parking lots of hospitals
      var hospitalNameRejectRe = /^\s*(คลินิก|clinic|ลานจอด|parking|แผนก|หน่วย)/i;

      return places.filter(function(p) {
        var types = p.types || [];
        for (var i = 0; i < types.length; i++) {
          if (globalBadTypes[types[i]]) return false;
          if (uiBad[types[i]]) return false;
        }
        if (uiType === 'hospital') {
          if (!p.name) return false;
          if (hospitalNameRejectRe.test(p.name)) return false;
          if (!hospitalNameRequiredRe.test(p.name)) return false;
        }
        if (p.name && badNameRe.test(p.name)) return false;
        return true;
      });
    },

    /**
     * Decode lat/lng from various Google Maps URL formats.
     * Supports:
     *   "15.7008, 100.1362"                       → raw coords
     *   https://www.google.com/maps/place/@15.7,100.1,17z
     *   https://www.google.com/maps?q=15.7,100.1   (also ?ll= or ?destination=)
     *   https://maps.app.goo.gl/abc                → follows redirect
     *   https://goo.gl/maps/abc                    → follows redirect
     *
     * Returns Promise<{lat:number, lng:number, name?:string} | null>
     * Used by GPS share dialog "paste Maps link" input method.
     */
    decodeGoogleMapsLink: async function(input) {
      var s = (input || '').trim();
      if (!s) return null;

      // 1. Raw "lat, lng" string
      var raw = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
      if (raw) {
        return { lat: parseFloat(raw[1]), lng: parseFloat(raw[2]) };
      }

      // 2. /@lat,lng,zoom format (within URL path)
      var atForm = s.match(/[@\?](-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
      if (atForm) {
        return { lat: parseFloat(atForm[1]), lng: parseFloat(atForm[2]) };
      }

      // 3. ?q=lat,lng or ?ll=lat,lng or destination=lat,lng query string
      var qForm = s.match(/[?&](?:q|ll|destination)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
      if (qForm) {
        return { lat: parseFloat(qForm[1]), lng: parseFloat(qForm[2]) };
      }

      // 4. Shortened URL — fetch + follow redirect, then recurse on resolved URL
      if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)/.test(s)) {
        try {
          var res = await fetch(s, { method: 'GET', redirect: 'follow' });
          var finalUrl = res.url || '';
          if (finalUrl && finalUrl !== s) {
            return await this.decodeGoogleMapsLink(finalUrl);
          }
        } catch (e) {
          // CORS or network — fall through to null
        }
      }

      return null;
    },

    _geoCache: {},
    _geoInflight: {}, // pending promises per cacheKey
    _geoCooldownUntil: 0, // Unix ms — skip geocoding until this time

    /**
     * Reverse geocode lat/lng → Thai administrative names.
     * Uses google.maps.Geocoder from Maps JS SDK (works with referrer-restricted
     * keys, unlike the REST Geocoding API which requires IP restrictions).
     *
     * Resilience features:
     * - Cache key rounded to 3 decimals (~111 m grid) — vehicles at rest hit cache.
     * - In-flight dedup: same coord in progress → returns the same Promise.
     * - Cooldown: on REQUEST_DENIED / OVER_QUERY_LIMIT → pause geocoding for 60s
     *   so console isn't spammed during API-propagation windows.
     * - Always resolves (never rejects). Empty result on any failure.
     */
    reverseGeocode: function(lat, lng) {
      var empty = { subdistrict: '', district: '', province: '', formatted: '' };
      if (!window.MapConfig) return Promise.resolve(empty);
      if (lat == null || lng == null) return Promise.resolve(empty);

      // Cooldown after a permanent-ish error
      if (Date.now() < this._geoCooldownUntil) return Promise.resolve(empty);

      var cacheKey = Number(lat).toFixed(3) + ',' + Number(lng).toFixed(3);
      if (this._geoCache[cacheKey]) return Promise.resolve(this._geoCache[cacheKey]);
      if (this._geoInflight[cacheKey]) return this._geoInflight[cacheKey];

      var self = this;
      var p = MapConfig.loadGoogleSDK().then(function() {
        return new Promise(function(resolve) {
          var geocoder = new google.maps.Geocoder();
          geocoder.geocode({
            location: { lat: Number(lat), lng: Number(lng) },
            language: 'th'
          }, function(results, status) {
            delete self._geoInflight[cacheKey];

            if (status !== 'OK' || !results || !results.length) {
              // Transient / permanent error — apply cooldown if looks permanent
              if (status === 'REQUEST_DENIED' || status === 'OVER_QUERY_LIMIT' ||
                  status === 'INVALID_REQUEST') {
                self._geoCooldownUntil = Date.now() + 60000; // 60s cooldown
              }
              // Cache empty only for ZERO_RESULTS (legitimately no address).
              // Don't cache for transient errors — allow retry after cooldown.
              if (status === 'ZERO_RESULTS') {
                self._geoCache[cacheKey] = empty;
              }
              resolve(empty);
              return;
            }
            var result = results[0] || {};
            var comps = result.address_components || [];
            var parsed = { subdistrict: '', district: '', province: '', formatted: result.formatted_address || '' };
            comps.forEach(function(c) {
              var t = c.types || [];
              if (t.indexOf('administrative_area_level_1') !== -1) parsed.province = c.long_name;
              else if (t.indexOf('administrative_area_level_2') !== -1) parsed.district = c.long_name;
              else if (t.indexOf('sublocality_level_2') !== -1 && !parsed.subdistrict) parsed.subdistrict = c.long_name;
              else if (t.indexOf('sublocality_level_1') !== -1 && !parsed.subdistrict) parsed.subdistrict = c.long_name;
              else if (t.indexOf('locality') !== -1 && !parsed.subdistrict) parsed.subdistrict = c.long_name;
            });
            self._geoCache[cacheKey] = parsed;
            resolve(parsed);
          });
        });
      }).catch(function() {
        delete self._geoInflight[cacheKey];
        return empty;
      });
      this._geoInflight[cacheKey] = p;
      return p;
    },

    /** Strip Thai admin prefix (ตำบล/อำเภอ/จังหวัด/เขต/แขวง) from a name. */
    _stripThaiPrefix: function(name, prefixes) {
      if (!name) return '';
      name = String(name).trim();
      for (var i = 0; i < prefixes.length; i++) {
        var p = prefixes[i];
        if (name.indexOf(p) === 0) {
          return name.substring(p.length).trim();
        }
      }
      return name;
    },

    /** Format Thai admin names as compact label, e.g. "ต.ในเมือง อ.เมือง จ.นครสวรรค์" */
    formatThaiAddress: function(geo) {
      if (!geo) return '';
      var sd = this._stripThaiPrefix(geo.subdistrict, ['ตำบล ', 'ตำบล', 'แขวง ', 'แขวง']);
      var d  = this._stripThaiPrefix(geo.district,    ['อำเภอ ', 'อำเภอ', 'เขต ', 'เขต']);
      var p  = this._stripThaiPrefix(geo.province,    ['จังหวัด ', 'จังหวัด']);
      var parts = [];
      if (sd) parts.push('ต.' + sd);
      if (d) parts.push('อ.' + d);
      if (p) parts.push('จ.' + p);
      return parts.join(' ');
    },

    /**
     * Get driving directions between two points via google.maps.DirectionsService.
     * Uses Maps JS SDK (works with referrer-restricted keys).
     * Requires 'Directions API' to be enabled in the Google Cloud project.
     * @returns {Promise<{distance, distanceMeters, duration, durationSeconds, path: [[lat,lng],...], startAddress, endAddress}>}
     */
    getDirections: async function(origin, destination, opts) {
      opts = opts || {};
      if (!window.MapConfig) throw new Error('MapConfig not loaded');
      await MapConfig.loadGoogleSDK();
      return new Promise(function(resolve, reject) {
        if (!google || !google.maps || !google.maps.DirectionsService) {
          reject(new Error('DirectionsService unavailable'));
          return;
        }
        var service = new google.maps.DirectionsService();
        service.route({
          origin: { lat: Number(origin.lat), lng: Number(origin.lng) },
          destination: { lat: Number(destination.lat), lng: Number(destination.lng) },
          travelMode: (opts.mode || google.maps.TravelMode.DRIVING),
          language: 'th',
          region: 'TH',
          drivingOptions: opts.departureTime ? {
            departureTime: opts.departureTime,
            trafficModel: google.maps.TrafficModel.BEST_GUESS
          } : undefined
        }, function(result, status) {
          if (status !== 'OK' || !result || !result.routes || !result.routes[0]) {
            reject(new Error('Directions ' + status));
            return;
          }
          var route = result.routes[0];
          var leg = (route.legs && route.legs[0]) || {};
          var path = (route.overview_path || []).map(function(p) {
            return [p.lat(), p.lng()];
          });
          resolve({
            distance: leg.distance ? leg.distance.text : '',
            distanceMeters: leg.distance ? leg.distance.value : null,
            duration: leg.duration ? leg.duration.text : '',
            durationSeconds: leg.duration ? leg.duration.value : null,
            path: path,
            startAddress: leg.start_address || '',
            endAddress: leg.end_address || '',
            summary: route.summary || ''
          });
        });
      });
    },

    /**
     * Get driving distance + duration between one origin and multiple destinations.
     * Uses google.maps.DistanceMatrixService (Maps JS SDK).
     * Requires 'Distance Matrix API' enabled in Google Cloud project.
     * @param {{lat, lng}} origin
     * @param {Array<{lat, lng}>} destinations — max 25 per request
     * @returns {Promise<Array<{status, distance, distanceMeters, duration, durationSeconds}>>}
     */
    getDistanceMatrix: async function(origin, destinations, opts) {
      opts = opts || {};
      if (!window.MapConfig) throw new Error('MapConfig not loaded');
      if (!destinations || !destinations.length) return [];
      await MapConfig.loadGoogleSDK();
      return new Promise(function(resolve, reject) {
        if (!google || !google.maps || !google.maps.DistanceMatrixService) {
          reject(new Error('DistanceMatrixService unavailable'));
          return;
        }
        var service = new google.maps.DistanceMatrixService();
        service.getDistanceMatrix({
          origins: [{ lat: Number(origin.lat), lng: Number(origin.lng) }],
          destinations: destinations.map(function(d) {
            return { lat: Number(d.lat), lng: Number(d.lng) };
          }),
          travelMode: (opts.mode || google.maps.TravelMode.DRIVING),
          language: 'th',
          region: 'TH',
          unitSystem: google.maps.UnitSystem.METRIC
        }, function(response, status) {
          if (status !== 'OK' || !response || !response.rows || !response.rows[0]) {
            reject(new Error('DistanceMatrix ' + status));
            return;
          }
          var elements = response.rows[0].elements || [];
          resolve(elements.map(function(el) {
            if (!el || el.status !== 'OK') return { status: el ? el.status : 'NO_DATA' };
            return {
              status: 'OK',
              distance: el.distance ? el.distance.text : '',
              distanceMeters: el.distance ? el.distance.value : null,
              duration: el.duration ? el.duration.text : '',
              durationSeconds: el.duration ? el.duration.value : null
            };
          }));
        });
      });
    },

    /** Format distance for display: "320 m" or "1.2 km" */
    formatDistance: function(meters) {
      if (meters == null) return '-';
      if (meters < 1000) return Math.round(meters) + ' m';
      return (meters / 1000).toFixed(1) + ' km';
    },

    haversineDistance: haversineDistance
  };

  global.PlacesAPI = PlacesAPI;
})(window);

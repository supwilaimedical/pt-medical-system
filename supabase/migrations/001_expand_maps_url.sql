-- ============================================================
-- Supabase Database Function: expand_maps_url
-- ทำหน้าที่เหมือน GAS loc_expandGoogleMapsLink()
-- Follow redirects ฝั่ง server แล้วดึงพิกัดจาก URL เต็ม
--
-- วิธีใช้:
-- 1. เปิด Supabase Dashboard → Database → Extensions → เปิด "http"
-- 2. คัดลอก SQL ทั้งหมดนี้ → ไปวางที่ SQL Editor → Run
-- 3. ทดสอบ: SELECT expand_maps_url('https://maps.app.goo.gl/xxx');
-- ============================================================

-- Step 1: Enable http extension (ถ้ายังไม่ได้เปิด)
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- Step 2: Create the function
CREATE OR REPLACE FUNCTION public.expand_maps_url(short_url TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_url TEXT := short_url;
  response RECORD;
  location_header TEXT;
  i INT;
  coord_match TEXT[];
  patterns TEXT[] := ARRAY[
    '/search/([-]?[0-9]+\.[0-9]+)[,+%%20]+([-]?[0-9]+\.[0-9]+)',
    '!3d([-]?[0-9]+\.[0-9]+)!4d([-]?[0-9]+\.[0-9]+)',
    '@([-]?[0-9]+\.[0-9]+),([-]?[0-9]+\.[0-9]+)',
    '[?&]q=([-]?[0-9]+\.[0-9]+),([-]?[0-9]+\.[0-9]+)',
    '[?&]ll=([-]?[0-9]+\.[0-9]+),([-]?[0-9]+\.[0-9]+)'
  ];
  p TEXT;
BEGIN
  -- Disable auto-redirect following (จะ follow เองทีละ hop)
  PERFORM http_set_curlopt('CURLOPT_FOLLOWLOCATION', '0');

  -- Follow redirects manually up to 10 hops (เหมือน GAS เดิม)
  FOR i IN 1..10 LOOP
    SELECT * INTO response FROM http_get(current_url);

    IF response.status >= 300 AND response.status < 400 THEN
      -- Extract Location header
      SELECT h.value INTO location_header
      FROM unnest(response.headers) AS h
      WHERE lower(h.field) = 'location'
      LIMIT 1;

      IF location_header IS NOT NULL THEN
        current_url := location_header;
      ELSE
        EXIT;
      END IF;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  -- Re-enable auto-redirect
  PERFORM http_set_curlopt('CURLOPT_FOLLOWLOCATION', '1');

  -- Try to extract lat/lng from the final resolved URL
  FOREACH p IN ARRAY patterns LOOP
    coord_match := regexp_match(current_url, p);
    IF coord_match IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'lat', coord_match[1],
        'lng', coord_match[2],
        'resolved_url', current_url
      );
    END IF;
  END LOOP;

  -- ถ้า URL ไม่มีพิกัด ลอง parse จาก HTML content
  IF response.content IS NOT NULL THEN
    FOREACH p IN ARRAY patterns LOOP
      coord_match := regexp_match(response.content, p);
      IF coord_match IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'lat', coord_match[1],
          'lng', coord_match[2],
          'resolved_url', current_url
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'message', 'ไม่พบพิกัดในลิงก์',
    'resolved_url', current_url
  );

EXCEPTION WHEN OTHERS THEN
  -- Re-enable auto-redirect on error
  PERFORM http_set_curlopt('CURLOPT_FOLLOWLOCATION', '1');
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

-- Step 3: Grant access
GRANT EXECUTE ON FUNCTION public.expand_maps_url(TEXT) TO anon, authenticated;

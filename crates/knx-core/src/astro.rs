use chrono::{DateTime, Datelike, Timelike, Utc};
use std::f64::consts::PI;

/// Calculates solar position (Azimuth, Elevation) in degrees for a given UTC time and coordinates.
/// - Azimuth: 0° = North, 90° = East, 180° = South, 270° = West
/// - Elevation: -90° (nadir) to +90° (zenith)
pub fn calculate_solar_position(dt: DateTime<Utc>, lat_deg: f64, lon_deg: f64) -> (f64, f64) {
    let lat_rad = lat_deg.to_radians();

    // Day of the year
    let day_of_year = dt.ordinal() as f64;
    let hour = dt.hour() as f64 + dt.minute() as f64 / 60.0 + dt.second() as f64 / 3600.0;

    // Fractional year in radians
    let gamma = 2.0 * PI / 365.0 * (day_of_year - 1.0 + (hour - 12.0) / 24.0);

    // Equation of time in minutes
    let eqtime = 229.18
        * (0.000075 + 0.001868 * gamma.cos() - 0.032077 * gamma.sin()
            - 0.014615 * (2.0 * gamma).cos()
            - 0.040849 * (2.0 * gamma).sin());

    // Solar declination in radians
    let decl = 0.006918 - 0.399912 * gamma.cos() + 0.070257 * gamma.sin()
        - 0.006758 * (2.0 * gamma).cos()
        + 0.000907 * (2.0 * gamma).sin()
        - 0.002697 * (3.0 * gamma).cos()
        + 0.00148 * (3.0 * gamma).sin();

    // True solar time in minutes
    let time_offset = eqtime + 4.0 * lon_deg;
    let tst = hour * 60.0 + time_offset;
    let ha_deg = (tst / 4.0) - 180.0;
    let ha_rad = ha_deg.to_radians();

    // Solar zenith angle
    let cos_zenith = lat_rad.sin() * decl.sin() + lat_rad.cos() * decl.cos() * ha_rad.cos();
    let zenith_rad = cos_zenith.clamp(-1.0, 1.0).acos();
    let elevation_deg = 90.0 - zenith_rad.to_degrees();

    // Solar azimuth angle (clockwise from North: 0° = N, 90° = E, 180° = S, 270° = W)
    let sin_zenith = zenith_rad.sin();
    let azimuth_deg = if sin_zenith.abs() < 1e-6 {
        180.0
    } else {
        let cos_azimuth = (lat_rad.sin() * cos_zenith - decl.sin()) / (lat_rad.cos() * sin_zenith);
        let cos_azimuth = cos_azimuth.clamp(-1.0, 1.0);
        let az = cos_azimuth.acos().to_degrees();
        if ha_deg > 0.0 {
            (az + 180.0) % 360.0
        } else {
            (540.0 - az) % 360.0
        }
    };

    (azimuth_deg, elevation_deg)
}

/// Human-readable compass cardinal direction
pub fn compass_direction(azimuth: f64) -> &'static str {
    let az = (azimuth % 360.0 + 360.0) % 360.0;
    if az >= 337.5 || az < 22.5 {
        "Nord (N)"
    } else if az < 67.5 {
        "Nord-Ost (NO)"
    } else if az < 112.5 {
        "Ost (O)"
    } else if az < 157.5 {
        "Süd-Ost (SO)"
    } else if az < 202.5 {
        "Süd (S)"
    } else if az < 247.5 {
        "Süd-West (SW)"
    } else if az < 292.5 {
        "West (W)"
    } else {
        "Nord-West (NW)"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_solar_position_berlin_noon() {
        // Solar noon in Berlin (52.5°N, 13.4°E) on summer solstice June 21 ~ 11:15 UTC
        let dt = Utc.with_ymd_and_hms(2026, 6, 21, 11, 15, 0).unwrap();
        let (az, el) = calculate_solar_position(dt, 52.5, 13.4);
        assert!(el > 58.0 && el < 63.0, "Elevation was: {}", el);
        assert!(az > 170.0 && az < 190.0, "Azimuth was: {}", az);
        assert_eq!(compass_direction(az), "Süd (S)");
    }
}

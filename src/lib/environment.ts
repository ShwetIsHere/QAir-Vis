export type Environment = {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  precipitation: number;
  weatherCode: number;
  cloudCover: number;
  pressure: number;
  visibility: number;
  windSpeed: number;
  uvIndex: number | null;
  aqi: number;
  pm25: number;
  pm10: number;
};

type WeatherResponse = {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    precipitation: number;
    weathercode: number;
    cloudcover: number;
    pressure_msl: number;
    visibility: number;
    wind_speed_10m: number;
  };
  daily?: {
    uv_index_max?: number[];
  };
};

type AirQualityResponse = {
  current: {
    pm10: number;
    pm2_5: number;
    us_aqi: number;
  };
};

export function getAqiCategory(aqi: number) {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

export async function fetchEnvironment(
  latitude: number,
  longitude: number,
): Promise<Environment> {
  const coordinates = `latitude=${latitude}&longitude=${longitude}`;
  const [weatherResponse, airResponse] = await Promise.all([
    fetch(
      `https://api.open-meteo.com/v1/forecast?${coordinates}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weathercode,cloudcover,pressure_msl,visibility,wind_speed_10m&daily=uv_index_max&timezone=auto`,
    ),
    fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?${coordinates}&current=pm10,pm2_5,us_aqi&timezone=auto`,
    ),
  ]);

  if (!weatherResponse.ok) {
    throw new Error(`Weather service returned HTTP ${weatherResponse.status}.`);
  }
  if (!airResponse.ok) {
    throw new Error(`Air quality service returned HTTP ${airResponse.status}.`);
  }

  const [weather, air] = await Promise.all([
    weatherResponse.json() as Promise<WeatherResponse>,
    airResponse.json() as Promise<AirQualityResponse>,
  ]);
  const values = [
    weather.current?.temperature_2m,
    weather.current?.apparent_temperature,
    weather.current?.relative_humidity_2m,
    weather.current?.precipitation,
    weather.current?.weathercode,
    weather.current?.cloudcover,
    weather.current?.pressure_msl,
    weather.current?.visibility,
    weather.current?.wind_speed_10m,
    air.current?.us_aqi,
    air.current?.pm2_5,
    air.current?.pm10,
  ];

  if (values.some(value => !Number.isFinite(value))) {
    throw new Error('Environmental services returned incomplete measurements.');
  }

  return {
    temperature: weather.current.temperature_2m,
    apparentTemperature: weather.current.apparent_temperature,
    humidity: weather.current.relative_humidity_2m,
    precipitation: weather.current.precipitation,
    weatherCode: weather.current.weathercode,
    cloudCover: weather.current.cloudcover,
    pressure: weather.current.pressure_msl,
    visibility: weather.current.visibility,
    windSpeed: weather.current.wind_speed_10m,
    uvIndex: weather.daily?.uv_index_max?.[0] ?? null,
    aqi: air.current.us_aqi,
    pm25: air.current.pm2_5,
    pm10: air.current.pm10,
  };
}

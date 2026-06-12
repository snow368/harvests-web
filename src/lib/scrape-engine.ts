// Stub — scrape engine runs via standalone Python scripts, not in-server.
// This stub keeps the server import working without the full engine.
export const scrapeState = async (
  _state: string,
  _cities: string[],
  _headless: boolean,
  _keyword: string,
  _country: string,
  _onProgress?: (completed: number, total: number) => void,
) => {
  throw new Error('Scrape engine is deprecated. Use standalone Python scripts (WA_Scanner.py) instead.');
};

export { }

declare global {
  interface ResultsStore {
    results: {
      data: DriverResult[]
    }
    fetching: boolean
  }

  interface DriverResult {
    Cla: string;
    Driver: string;
    "#": string;
    column3: string;
    Chassis: string;
    Engine: string;
    Laps: string;
    Time: string;
    Interval: string;
    "km/h": string;
  }
}

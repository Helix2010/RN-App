import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { fakeNavigation, renderWithProviders } from "../../test/harness";
import type { PreparedReport } from "../../core/diagnostics/report-service";
import { ReportProblemScreen } from "./report-problem-screen";

const prepared: PreparedReport = {
  reportId: "rpt_0123456789abcdef0123456789abcdef",
  kind: "user",
  occurredAt: "2026-09-14T08:00:00.000Z",
  app: {
    version: "1.2.3",
    buildNumber: "45",
    runtimeVersion: "1.2.0",
    otaChannel: "production",
    distributionChannel: "direct",
    launchSource: "embedded",
    locale: "zh-CN",
    osVersion: "35",
    deviceClass: "android-phone",
  },
  context: { screen: "Transfer", lastRequestId: "req-9" },
  entries: [
    {
      at: Date.UTC(2026, 8, 14, 8, 0, 0),
      level: "error",
      tag: "net",
      message: "request failed",
      fields: { status: 503 },
    },
  ],
};

const mockPrepare = jest.fn(() => prepared);
const mockSubmit = jest.fn();
jest.mock("../../core/diagnostics/report-service", () => ({
  prepareReport: (...args: unknown[]) => mockPrepare(...(args as [])),
  submitReport: (...args: unknown[]) => mockSubmit(...args),
}));

beforeEach(() => {
  mockPrepare.mockClear();
  mockSubmit.mockReset();
});

async function open() {
  const navigation = fakeNavigation();
  await renderWithProviders(
    <ReportProblemScreen navigation={navigation} route={undefined as never} />,
  );
  return navigation;
}

describe("ReportProblemScreen", () => {
  it("shows exactly what will be sent before anything leaves the device", async () => {
    await open();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("1.2.3（Build 45）")).toBeTruthy();
    expect(screen.getByText("Transfer")).toBeTruthy();
    expect(screen.getByText("日志 1 条")).toBeTruthy();
    expect(screen.getByTestId("report-problem-entries").props.children).toBe(
      "08:00:00.000 ERROR net request failed status=503",
    );
    // 同意是在知情的前提下：说清会关联账号与设备
    expect(screen.getByText(/关联你当前登录的账号和这台设备/)).toBeTruthy();
  });

  it("sends the prepared report with the note and shows the reference", async () => {
    mockSubmit.mockResolvedValue({
      status: "submitted",
      reference: "R7KQ3M2X",
      logStored: true,
    });
    const navigation = await open();
    await fireEvent.changeText(
      screen.getByTestId("report-problem-note"),
      "转账一直转圈",
    );
    await fireEvent.press(screen.getByTestId("report-problem-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("report-problem-reference")).toBeTruthy(),
    );
    expect(mockSubmit).toHaveBeenCalledWith(prepared, "转账一直转圈");
    expect(screen.getByText("R7KQ3M2X")).toBeTruthy();
    expect(screen.queryByTestId("report-problem-log-missing")).toBeNull();

    await fireEvent.press(screen.getByTestId("report-problem-close"));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it("still gives the reference when only the log could not be uploaded", async () => {
    mockSubmit.mockResolvedValue({
      status: "submitted",
      reference: "R7KQ3M2X",
      logStored: false,
    });
    await open();
    await fireEvent.press(screen.getByTestId("report-problem-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("report-problem-log-missing")).toBeTruthy(),
    );
  });

  it("explains a failure and retries with the same report", async () => {
    mockSubmit
      .mockResolvedValueOnce({ status: "failed", reason: "network" })
      .mockResolvedValueOnce({
        status: "submitted",
        reference: "R7KQ3M2X",
        logStored: true,
      });
    await open();
    await fireEvent.press(screen.getByTestId("report-problem-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("report-problem-error")).toBeTruthy(),
    );
    expect(screen.getByText("网络不稳定，请检查网络后重试")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("report-problem-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("report-problem-reference")).toBeTruthy(),
    );
    // 重试发的是同一份（同一个 reportId）：若第一次其实已到达服务端，拿回的是同一个参考号
    expect(mockSubmit.mock.calls[1]?.[0]).toBe(mockSubmit.mock.calls[0]?.[0]);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });
});

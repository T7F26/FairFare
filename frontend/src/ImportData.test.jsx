import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, it, expect, vi, beforeEach} from "vitest";
import ImportData from "./ImportData";
import "@testing-library/jest-dom";

describe("ImportData Component", () =>{
    beforeEach(()=>{
        global.fetch = vi.fn();
    });
    it("renders the form correctly", () => {
        render(<ImportData/>);
        expect(screen.getByText("Import Agency Data")).toBeInTheDocument();
        expect(screen.getByLabelText(/Agency/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/GTFS file/i)).toBeInTheDocument();
        expect(screen.getByRole("button",{name: /Upload/i})).toBeInTheDocument();
    });
    it("shows an error if submitted without a file or agency", async() => {
        render(<ImportData/>);
        const button = screen.getByRole("button", {name: /Upload/i});
        await userEvent.click(button);
        expect(screen.getByText(/✖ Choose an agency/i)).toBeInTheDocument();
    });
    it("shows a success message and record count on valid upload", async() => {
    global.fetch.mockResolvedValueOnce({
        ok:true,
        json: async () => ({ valid: true, recordCounts: { "stops.txt": 10, "routes.txt": 5 } }),
    });
    render(<ImportData/>);
    await userEvent.selectOptions(screen.getByLabelText(/Agency/i),"TTC");
    const file = new File(["zipcontent"],"feed.zip",{type: "application/zip"});
    await userEvent.upload(screen.getByLabelText(/GTFS file/i), file);
    await userEvent.click(screen.getByRole("button", {name: /Upload/i}));
    await waitFor(()=> {
        expect(screen.getByText(/15 records imported/i)).toBeInTheDocument();
    });
});
it("shows the specific error message if the API rejects the file", async() => {
    global.fetch.mockResolvedValueOnce({
        ok: false,
        json: async() => ({code: "AGENCY_MISMATCH"}),
    });
    render(<ImportData/>);
    await userEvent.selectOptions(screen.getByLabelText(/Agency/i),"TTC");
    const file = new File(["zipcontent"],"feed.zip",{type:"application/zip"});
    await userEvent.upload(screen.getByLabelText(/GTFS file/i), file);
    await userEvent.click(screen.getByRole("button", {name: /Upload/i}));
    await waitFor(()=> {
        expect(screen.getByText(/This file does not match the chosen agency/i)).toBeInTheDocument();
    });
});
});

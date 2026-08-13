from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> None:
    screenshot_path = Path("/tmp/creator-copilot-home.png")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        )
        page = browser.new_page(viewport={"width": 1440, "height": 920}, device_scale_factor=1)
        page.goto("http://127.0.0.1:4316", wait_until="networkidle")
        page.screenshot(path=str(screenshot_path), full_page=True)
        assert page.get_by_role("heading", name="今天，先把一个观点讲清楚。", exact=True).is_visible()
        assert page.get_by_text("正在推进", exact=True).is_visible()
        page.get_by_role("button", name="选题库").click()
        assert page.get_by_role("heading", name="选题库", exact=True).is_visible()
        page.get_by_role("button", name="回到今天").click()
        assert page.get_by_role("heading", name="今天，先把一个观点讲清楚。", exact=True).is_visible()
        print(f"UI smoke passed; screenshot={screenshot_path}")
        browser.close()


if __name__ == "__main__":
    main()

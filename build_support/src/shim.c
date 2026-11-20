#include <windows.h>

// this comes pre-compiled, this is just here for debug convenience.
// the "compile.bat" may be executed as a shell script as well.

// no crt needed
void WinMainCRTStartup(void) {
    STARTUPINFO si = { sizeof(STARTUPINFO) };
    PROCESS_INFORMATION pi = { 0 };

    if (CreateProcess(NULL, "cmd /c \"launcher.bat\"", NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        // no need to wait before releasing handles
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }
}

const socket = io();
const terminals = {};
let uuid = ""

socket.on('welcome', (data) => {
    console.log(data.message);
});

socket.on('connect', () => {
    uuid = socket.id
    console.log(uuid); 
    const sshString = document.getElementById('sshString').value;
    if(sshString != ""){
        socket.emit('reconnect_ssh', {server: sshString, uuid: uuid});
    }
 });

function login() {
    const sshString = document.getElementById('sshString').value;
    const pemFile = document.getElementById('pemFile').files[0];

    const formData = new FormData();
    formData.append('sshString', sshString);
    formData.append('pemFile', pemFile);
    formData.append('uuid', uuid);

    fetch('/login', {
        method: 'POST',
        body: formData
    }).then(response => response.text())
      .then(data => {
          document.getElementById('loginStatus').innerText = data;
      });
}

function listPods() {
    const sshString = document.getElementById('sshString').value;
    fetch('/list-pods?sshString='+sshString)
        .then(response => response.text())
        .then(data => {
            const pods = data.split('\n').slice(1).filter(line => line.trim() !== '');
            const podsList = document.getElementById('podsList');
            podsList.innerHTML = '';
            pods.forEach(podLine => {
                const podName = podLine.split(/\s+/)[0];
                const podDiv = document.createElement('div');
                podDiv.className = 'pod-item';
                podDiv.innerHTML = `<button class="btn btn-secondary btn-sm m-2" onclick="getLogs('${podName}')">${podName}</button>`;
                podsList.appendChild(podDiv);
            });
        });
}

function getLogs(podName) {
    const sshString = document.getElementById('sshString').value;
    fetch(`/logs/${podName}?sshString=`+sshString)
        .then(response => response.text())
        .then(data => {
            const logTabs = document.getElementById('logTabs');
            const logTabsContent = document.getElementById('logTabsContent');

            const tabId = `tab-${podName}`;
            const contentId = `content-${podName}`;

            if (!document.getElementById(tabId)) {
                const tabItem = document.createElement('li');
                tabItem.className = 'nav-item';
                tabItem.innerHTML = `<a class="nav-link" id="${tabId}" data-toggle="tab" href="#${contentId}" role="tab">
                                        ${podName.slice(0, 6)}...${podName.slice(-6)}
                                        <button class="btn btn-sm btn-danger ml-2" onclick="closeTab(event, '${podName}')">x</button>
                                    </a>`;
                logTabs.appendChild(tabItem);

                const tabContent = document.createElement('div');
                tabContent.className = 'tab-pane fade';
                tabContent.id = contentId;
                tabContent.setAttribute('role', 'tabpanel');

                tabContent.innerHTML = `<div id="logs-${podName}" class="log-content"></div>`;
                logTabsContent.appendChild(tabContent);

                const terminal = new Terminal({
                    cols: 140,
                    rows: 40,
                    convertEol: true
                });
                const fitAddon = new FitAddon.FitAddon();
                terminal.loadAddon(fitAddon);
                terminal.open(document.getElementById(`logs-${podName}`));
                fitAddon.fit();
                terminal.write(data);
                terminals[podName] = { terminal, fitAddon };
            }

            document.getElementById(tabId).click();
        });

    socket.on('log', (data) => {
        if (data.podName === podName) {
            const { terminal } = terminals[podName];
            terminal.write(data.log);
        }
    });
}

function closeTab(event, podName) {
    event.stopPropagation();

    const tabId = `tab-${podName}`;
    const contentId = `content-${podName}`;

    document.getElementById(tabId).parentElement.remove();
    document.getElementById(contentId).remove();

    fetch('/stop-logs', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ podName })
    }).then(response => response.text())
      .then(data => {
          console.log(data);
      });

    socket.off('log', (data) => {
        if (data.podName === podName) {
            const { terminal } = terminals[podName];
            terminal.write(data.log);
        }
    });

    // Dispose terminal
    if (terminals[podName]) {
        terminals[podName].terminal.dispose();
        delete terminals[podName];
    }
}

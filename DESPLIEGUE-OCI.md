# DemocraXSSy en Oracle Linux 9 con Docker, Nginx y Certbot

Esta guía parte de la segunda VM de Compute ya creada, con IPv4 pública, SSH y Certbot. La primera VM sirve el frontend en `http://150.230.169.80`. Usá la IPv4 **de la segunda VM** en cada lugar que indique IP_BACKEND.

**Recorrido de una jugada:** navegador → IP pública del backend por 443 → Nginx en Oracle Linux → 127.0.0.1:3000 → contenedor de Express → volumen de SQLite. HTTP usa el mismo recorrido por 80. El navegador hace la petición, por lo que 80 y 443 deben ser accesibles desde los equipos de los jugadores. Mantené el puerto 3000 cerrado en OCI y en el firewall público. Docker lo vincula únicamente a la interfaz local de la VM. [Publicación de puertos de Docker](https://docs.docker.com/engine/network/port-publishing/)

## 1. Revisar la VM del backend por SSH

Entrá con el acceso habitual. En la sesión Linux ejecutá:

```bash
cat /etc/oracle-release
uname -m
sudo ss -lntp | grep -E ':(80|443|3000)[[:space:]]'
certbot --version
sudo docker version
sudo docker compose version
```

Si Docker todavía no está instalado, los últimos comandos pueden indicar que no existe. Anotá qué programa escucha en cada puerto. La guía usa **Nginx en la VM**. Si ya atiende Nginx, integrá la configuración del paso 5 en el sitio de esta IP. Si otro servidor ya usa 80/443, conservá ese servicio y configurá allí el mismo destino del proxy y el certificado, o coordiná su sustitución antes de arrancar Nginx. El puerto local 3000 debe estar disponible para Docker.

## 2. Instalar Docker Engine y Compose si hacen falta

Si los dos comandos de Docker ya mostraron el servidor Docker Engine y la versión de Compose, pasá al paso 3. Para una instalación nueva en Oracle Linux 9:

```bash
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/oracle/docker-ce.repo
sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Al aceptar la clave del repositorio, cotejá su huella con la documentación. Si DNF indica conflicto con Podman, runc o una instalación previa, revisá la transacción y los contenedores existentes antes de retirar paquetes. El mensaje de éxito de hello-world confirma que el motor puede descargar y ejecutar imágenes. [Instalación oficial en Oracle Linux](https://docs.docker.com/engine/install/oraclelinux/)

## 3. Copiar el proyecto desde Windows

En **PowerShell de tu computadora** reemplazá la IP y la ruta de la clave. Usá el usuario SSH que ya les funciona (en las imágenes de Oracle Linux suele ser opc).

```powershell
$VmIp = 'IP_BACKEND'
$Clave = 'C:\ruta\clave-privada.key'
$Destino = "opc@$VmIp"
Set-Location C:\Workspaces\redes2\democraxxsy-backend
ssh -i $Clave $Destino 'mkdir -p ~/democraxxsy-backend'
scp -i $Clave -r Dockerfile .dockerignore compose.yaml package.json package-lock.json src tests "${Destino}:democraxxsy-backend/"
```

Así se transfieren el código, el catálogo de cartas y los archivos de construcción. Si ya publicaron esta versión del repositorio, también pueden clonarla en la VM en ese directorio.

## 4. Construir la imagen y probar Express

En la **sesión SSH**:

```bash
cd ~/democraxxsy-backend
vi .env
```

Agregá o actualizá la línea `CORS_ORIGIN=*` para permitir que los frontends de todos los grupos usen la API desde el navegador. Si seguiste la versión anterior de la guía, reemplazá el valor que apuntaba a una sola IP. En vi, presioná **i** para editar y luego **Esc**, **:wq**, **Enter** para guardar. Usá el compose.yaml de esta entrega. Si antes preparaste un compose.override.yaml para Caddy, usá explícitamente `-f compose.yaml` como en los comandos siguientes.

```bash
sudo docker compose -f compose.yaml config --quiet
sudo docker compose -f compose.yaml build
sudo docker compose -f compose.yaml up -d --wait
sudo docker compose -f compose.yaml ps
curl -i http://127.0.0.1:3000/api/salud
```

La imagen construye las dependencias nativas en Linux y ejecuta las pruebas antes de generar la imagen final. Esperá ver el servicio api saludable y una respuesta HTTP 200 con `{"estado":"ok"}`. Si falla, consultá `sudo docker compose -f compose.yaml logs --tail=100 api`. Si falla durante el build, revisá el primer error de la construcción. Esta prueba local aísla Express y SQLite de los problemas de certificados o red pública.

## 5. Conectar Nginx con Docker y servir HTTP

En la VM instalá Nginx si hace falta con `sudo dnf install nginx`. El ejemplo usa el directorio web predeterminado de Nginx para que Certbot pueda validar la IP. Crealo con `sudo mkdir -p /usr/share/nginx/html/.well-known/acme-challenge`. Editá `sudo vi /etc/nginx/conf.d/democraxssy.conf` y guardá este bloque sustituyendo IP_BACKEND por la IPv4 real. Si ya existe un bloque server para esa misma IP y puerto, editá el existente para evitar duplicados.

```nginx
server {
    listen 80;
    server_name IP_BACKEND;

    location ^~ /.well-known/acme-challenge/ {
        root /usr/share/nginx/html;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

En Oracle Linux con SELinux en modo Enforcing, permití a Nginx conectar con su destino TCP con `sudo setsebool -P httpd_can_network_connect on`. Validá y aplicá:

```bash
sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx
```

En **PowerShell de tu PC**, ejecutá `curl.exe -i "http://$VmIp/api/salud"`. Debe devolver 200. Si la prueba local del paso 4 funciona y esta vence por tiempo, revisá la lista de seguridad/NSG de OCI y la zona activa de firewalld en la VM con `sudo firewall-cmd --get-active-zones` y `sudo firewall-cmd --zone=ZONA_ACTIVA --list-all`. Si faltan servicios en esa zona, agregá http y https con `sudo firewall-cmd --permanent --zone=ZONA_ACTIVA --add-service=http --add-service=https` y `sudo firewall-cmd --reload`. Sustituí ZONA_ACTIVA por la de la interfaz. Conservá la regla SSH que ya utilizan. Un 502 orienta a problemas entre Nginx y Express; revisá `sudo tail -n 40 /var/log/nginx/error.log`.

## 6. Asociar el certificado de la IP a Nginx

Usá el Certbot instalado en la segunda VM. Para su procedimiento con webroot, el directorio servido por el paso 5 es `/usr/share/nginx/html`. Si todavía no emitieron el certificado, este ejemplo requiere Certbot 5.4 o posterior:

```bash
read -rp 'IPv4 pública del backend: ' IP_API
sudo certbot certonly --webroot -w /usr/share/nginx/html --preferred-profile shortlived --ip-address "$IP_API" --cert-name "$IP_API"
sudo certbot certificates
```

Si ya lo emitieron con otro método, usen las rutas reales de Certificate Path y Private Key Path que informa Certbot. Agregá este **segundo bloque** al archivo del paso 5, sustituyendo IP_BACKEND en los tres lugares. El bloque del puerto 80 sigue atendiendo la API y la validación webroot.

```nginx
server {
    listen 443 ssl;
    server_name IP_BACKEND;
    ssl_certificate /etc/letsencrypt/live/IP_BACKEND/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/IP_BACKEND/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ejecutá `sudo nginx -t && sudo systemctl reload nginx`. Configurá la recarga después de renovar si su método aún no la incluye:

```bash
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
printf '%s\n' '#!/bin/sh' 'nginx -t && systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/democraxssy-nginx >/dev/null
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/democraxssy-nginx
systemctl list-timers --all | grep -Ei 'certbot|letsencrypt'
sudo certbot renew --dry-run --run-deploy-hooks
```

Confirmá que el mecanismo de renovación de su instalación tenga una próxima ejecución (timer activo o cron ya configurado). Si el paquete incluye un timer inactivo, identificá su nombre con `systemctl list-unit-files '*certbot*.timer'` y habilitalo con `sudo systemctl enable --now NOMBRE.timer`. La prueba manual verifica el proceso; el programador permite repetirlo durante los 160 h de vigencia del certificado. [Certificados de IP con Certbot](https://letsencrypt.org/2026/03/11/shorter-certs-certbot.html)

## 7. Probar los dos protocolos y el frontend

Desde PowerShell, con la variable $VmIp del paso 3:

```powershell
curl.exe -i "http://$VmIp/api/salud"
curl.exe -I "https://$VmIp/api/salud"
curl.exe -i "https://$VmIp/api/salud"
curl.exe -i -X OPTIONS "https://$VmIp/api/partidas" -H "Origin: https://otro-grupo.example" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type"
```

Esperá 200 en salud, certificado aceptado por tu equipo y 204 en OPTIONS con `Access-Control-Allow-Origin: *`, POST y las cabeceras solicitadas. El dominio de ejemplo simula otro origen. Para verificar la integración real, abrí el frontend de otro grupo, seleccioná esta API por HTTPS, creá una sala y consultá la mano con el token del jugador.

1. Abrí `http://150.230.169.80/`. Para demostrar HTTP seleccioná `http://IP_BACKEND` y verificá salud con una sesión de prueba. Para la partida seleccioná **https://IP_BACKEND** en cada dispositivo, sin puerto ni /api.
2. Usá cuatro dispositivos, navegadores o perfiles independientes. El anfitrión crea una partida a dos puntos, comparte el ID, los otros tres se unen e inicia el juego. Registrá las solicitudes en la pestaña Red del navegador.
3. Los participantes envían respuestas y votos; el soberano decide. Avanzá tras la primera ronda. Cuando alguien alcance la meta, esperá a que todos vean el resultado antes de que el anfitrión finalice. Registrá los estados de crear/unirse (201), consultar/iniciar/responder/votar/decidir/avanzar (200) y eliminar (204). Ocultá los tokens al compartir evidencias.
4. Cuando el frontend vuelva a HTTPS, conservá `CORS_ORIGIN=*`. En la revisión final usá HTTPS para ambas capas. Un frontend servido por HTTPS normalmente bloquea llamadas a una API HTTP pública.

## 8. Actualizar y comprobar persistencia

Con otra sala de prueba abierta, anotá su ID y ejecutá en la carpeta del backend:

```bash
sudo docker compose -f compose.yaml up -d --force-recreate --wait api
sudo docker compose -f compose.yaml ps
sudo docker stats --no-stream
```

Recargá el navegador con la misma sesión y comprobá que la sala y los jugadores siguen allí. El volumen nombrado partidas reside en el disco de la VM. Para desplegar cambios, copiá la nueva versión y repetí build y up del paso 4. Conservá el volumen y el disco; la opción down -v eliminaría los datos. La aplicación también aplica su propia caducidad a salas inactivas.

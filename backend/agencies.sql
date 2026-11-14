CREATE TABLE IF NOT EXISTS agencies (
    agency_id VARCHAR(255) PRIMARY KEY,
    agency_name VARCHAR(255) NOT NULL,
    agency_url TEXT NOT NULL,
    agency_timezone VARCHAR(255) NOT NULL
);

INSERT INTO agencies (agency_id, agency_name, agency_url, agency_timezone) VALUES
('ttc', 'Toronto Transit Commission', 'https://www.ttc.ca', 'America/Toronto'),
('miway', 'MiWay', 'https://www.mississauga.ca/miway', 'America/Toronto'),
('brampton_transit', 'Brampton Transit', 'https://www.brampton.ca', 'America/Toronto'),
('yrt', 'York Region Transit', 'https://www.yrt.ca', 'America/Toronto'),
('gotransit', 'GO Transit', 'https://www.gotransit.com', 'America/Toronto'),
('up_express', 'UP Express', 'https://www.upexpress.com', 'America/Toronto')

ON CONFLICT (agency_id) DO NOTHING;